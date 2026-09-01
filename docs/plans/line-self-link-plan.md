# Self-Service LINE Account Link — Implementation Plan

Spec: [[specs/line-self-link-spec]] · Status: **executing** (Owner order 2026-09-01)
Delivery: single branch with slice A (admin console QR button, already implemented + tested 2026-09-01).

## Phase 1 — API

1. **Use case** `apps/api/src/modules/auth/application/use-cases/issue-self-line-link-token.use-case.ts`
   — mirror `PartnerMemberLineLinkTokenUseCase` shape: find caller's ACTIVE membership in ACTIVE company
   (404 otherwise), `generateLineLinkToken()` **default 15m TTL**, transactional revoke-prior + create +
   audit, return `EmployeeLineLinkPackage` via `buildLineLinkPackage`. `issuedByUserId = userId`.
   Reuse helpers from `employee-access.logic.ts`; no new crypto, no new shapes.
2. **Audit action** — add self-issue key to `AuditAction` following the existing `AUTH_*` naming.
3. **Controller** — `POST line/self-link-token` in `auth.controller.ts` next to `line/link`;
   `@RequirePermissions('account.identity.link')`; `trustedPublicApiBase(req)`; no body DTO (no body).
   Wire provider in `auth.module.ts`.
4. **Account security state** — add `lineLinked` / `lineLinkedAt` to
   `get-account-security-state.use-case.ts` (query `externalIdentity` ACTIVE LINE for user, additive).
5. **Permissions** — in `permission-registry.ts`, add `account.identity.link` (only — unlink is not
   widened, spec §5) to every role block carrying `account.password.change` that lacks it (MANAGER,
   FINANCE, ACCOUNTANT, STAFF/`STAFF_ROLE_GRANTS`; check AUDITOR_READONLY and others by the same rule).
6. **Rate limit** — only if `AuthRateLimitService` offers a one-line per-user fit; otherwise skip and note.

## Phase 2 — Web

7. **API client** `auth.api.ts` — `issueSelfLineLinkToken(): Promise<EmployeeLineLinkPackage>`;
   extend `AccountSecurityState` type. (No unlink client fn — see step 8.)
8. **Sidebar** `AppSidebar.tsx` — menu item between Reset password and sign-out, rendered when
   `showAccountSecurity` (same flag as Reset password — it already keys on the link permissions).
   Status badge from a lazy `getAccountSecurityState()` fired when the menu opens. Click →
   - not linked, mobile: mint → `window.location.href = linkUrl`
   - not linked, desktop: mint → QR modal (reuse `Modal` from `@/common/components/modal` like the
     sign-out confirm; render `qrImageUrl` + "สร้าง QR ใหม่" + expiry note; poll state ~5s while open)
   - linked: item DISABLED, no click action (Owner 2026-09-01 — protect LINE OA push quota); no
     unlink client fn, no manage modal
   Mobile/desktop split: same mechanism the sidebar uses for the drawer (do not invent a new breakpoint).
9. **i18n** — th/en keys in `workspace-dictionary.ts` (`shell.line_link.*`).

## Phase 3 — Tests (wire every new spec into `apps/api/package.json` test script — the
spec-suite-coverage guard enforces it; this is the sanctioned package.json exception)

10. Use-case spec: self-scope (mint only for ctx user), 15m TTL bounds, revoke-prior sweep,
    no `userCredential` touch, 404 on inactive membership with zero writes, hash-not-raw storage.
11. `auth.controller.spec.ts` / `auth-endpoints.spec.ts`: permission metadata for the new route.
12. `permission-registry.spec.ts` + role-template parity/read-coverage specs: updated grants.
13. Account-security-state spec: lineLinked true/false paths.
14. Web: extend `AppSidebar.spec.ts` / `app-sidebar.logic.ts` coverage for the menu-item render +
    badge states if the logic lands in a testable pure function (prefer that).

## Phase 4 — Verify

15. `pnpm --filter @watchdog-bms/api test`, both typechecks, `pnpm --filter @watchdog-bms/web test`.
16. Manual: dev stack, link journey + linked-state disabled item; record results in task memory.

## Guardrails for the implementer

- **Do not touch**: `line/exchange` (stays fail-closed), `CompleteEmployeeLineLinkUseCase`, LIFF pages,
  employee/owner QR flows, `package.json` beyond the test-script spec paths.
- Shortest correct diff (ponytail full); reuse `PartnerMemberLineLinkTokenUseCase` and `QrLinkCard`
  patterns instead of inventing parallel ones.
- `x-company-id`/request context provides the company; there is no company parameter on the endpoint.
- Keep the H-09 invariants from the spec §6 intact; they are acceptance, not suggestions.

## Task memory

`docs/agent-memory/line-self-link-delivery.md` — created at kickoff, updated at review + merge.
