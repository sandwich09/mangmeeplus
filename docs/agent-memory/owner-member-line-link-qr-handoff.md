# Agent Memory: owner-member-line-link-qr-handoff

Status: Implemented, unit-verified; browser/E2E pass pending
Owner: thawtchai + Claude
Scope: Company onboarding handoff and employee creation now auto-issue a single-use LINE account-link QR bound to companyId + membership + user, reusing the existing `EmployeeLineLinkToken` machinery.

Decisions:
- Reuse `EmployeeLineLinkToken` + `/v1/auth/line/employee-link-page` + `complete-employee-line-link` for the owner; no new token model or link page. Completion only requires an active membership, so the owner needs no `EmployeeAccessProfile`.
- Owner QR TTL = ~~72h~~ **24h ตั้งแต่ 2026-07-18 (H-09)** (`OWNER_LINE_LINK_TOKEN_TTL_MS`) — QR เป็น bearer credential จึงสั้นกว่า temp password (72h); หมดอายุแล้ว regenerate ได้; employee in-person QR keeps 15 minutes.
- `regenerate-temporary-password` also revokes pending owner tokens and returns a fresh QR package, so an expired handoff refreshes in one call.
- Shared helpers `buildLineLinkPackage()` and `generateLineLinkToken(ttlMs?)` live in `employee-access.logic.ts`; system-onboarding imports the pure logic (no repository coupling).
- QR page moved to `/v1/auth/line/link-page/employee` (old `/v1/auth/line/employee-link-page` kept as route alias) so `liff.login` redirectUri stays inside the LIFF endpoint URL scope.
- 2026-07-06: mangmeeplus.com cutover broke first scan with LINE 400 Bad Request. QR links now use `https://mangmeeplus.com/...` (PUBLIC_DOMAIN_URL) but LIFF app 2010515251-rvdZJ8la endpoint URL in LINE console still points to `https://wa-d522885832ce41a5aa7f8d1ffbaaa84b.ecs.ap-southeast-1.on.aws/v1/auth/line/link-page` (verified via liff.line.me shim redirect), so `liff.login` redirectUri falls outside the endpoint scope and access.line.me rejects with 400. Fix = update LIFF endpoint URL in console to `https://mangmeeplus.com/v1/auth/line/link-page` (LIFF is used only by the link pages; web login does not use LIFF). Side effect: pre-cutover QRs on the on.aws host will then 400 (≤72h TTL, mostly expired; regenerate handoff if needed).
- ~~QR image still rendered via api.qrserver.com~~ **แก้แล้ว 2026-07-18 (H-09): QR สร้าง local ด้วย `qrcode-generator` เป็น SVG data URI — bearer link ห้ามออกไป third party เด็ดขาด อย่า reintroduce external QR service** (ดู `docs/agent-memory/h-09-line-link-qr-claim-race.md`).

Artifacts:
- apps/api/src/modules/employee-access/domain/logic/employee-access.logic.ts (TTL param, buildLineLinkPackage, OWNER_LINE_LINK_TOKEN_TTL_MS)
- apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.ts (+ token in tx, lineLink in handoff)
- apps/api/src/modules/employee-access/presentation/http/employee.controller.ts (create passes publicApiBase)
- apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.use-case.ts (ownerLineLink in result)
- apps/api/src/modules/system-onboarding/application/use-cases/regenerate-temporary-password.use-case.ts (rotates owner QR)
- apps/api/src/modules/system-onboarding/presentation/http/system-onboarding.controller.ts (apiBaseUrl wiring)
- packages/contracts/src/employee-access.ts (EmployeeCredentialHandoff.lineLink?)
- apps/web/src/features/system-onboarding/SystemOnboardingNewPage.tsx (OwnerLineLinkCard + instructions)
- apps/web/src/features/employee-access/EmployeeAccessPages.tsx (QrLinkCard in create handoff)
- docs/specs/admin-company-onboarding-spec.md, docs/specs/employee-access-role-management-spec.md

Verification:
- `pnpm exec tsx --test` on create-company-onboarding.spec.ts, create-employee.use-case.spec.ts, employee-lifecycle, employee-access.logic, complete-employee-line-link: 37/37 pass (includes new assertions: owner QR 72h TTL, raw token never persisted, employee lineLink in handoff).
- `pnpm --filter @watchdog-bms/api typecheck`, `pnpm --filter @watchdog-bms/web typecheck`: clean.

Open questions:
- Local-dev env gap remains: root `.env` has dead trycloudflare `LINE_ACCOUNT_LINK_URL` and empty-string `LINE_ACCOUNT_LINK_QR_IMAGE_URL` (empty string defeats `??` fallback on change-password page). Separate cleanup.
- LINE Login channel is still in Developing status — only channel admins/testers can complete LINE Login; must Publish before real customers scan the QR.

- 2026-07-07: LIFF endpoint URL updated + channel published by user. Prod logs (`/ecs/watchdog-bms-api-web`) confirm first owner link SUCCEEDED: POST /v1/auth/line/employee-link 200 at 23:57:39+07, followed by three 403s (23:57:52, 00:02:36, 00:02:44 — 3-4ms early exits) from re-running link on the single-use token.
- 2026-07-07 fix (local, not yet deployed): complete-employee-line-link now treats a USED token re-scanned by the already-linked LINE account as idempotent success (verify idToken → ExternalIdentity match on userId+providerUserId+ACTIVE; any other account still gets the generic 403; REVOKED unchanged). Employee link page disables the button during flight and after success, re-enables only on failure (`button:disabled` style added). Swagger 200/403 descriptions updated.

Verification (2026-07-07): complete-employee-line-link.use-case.spec.ts 11/11 pass (3 new re-scan cases: same-user success with no token update and no linkLineIdentity call, other-user reject, verify-failure reject); `pnpm --filter @watchdog-bms/api typecheck` clean; local boot on :3101 — rendered employee link page contains linkBtn disable logic + `button:disabled` CSS, and POST with unknown token still 403.

- 2026-07-07 deployed: ECS `all` at `acb73a08-20260707154632` (api-web-pub task-def :53 rollout COMPLETED, canary no-rollback; health 200 via mangmeeplus.com, db ok) — idempotent re-scan + button fix now live.

- 2026-07-07 (post-link UX): user reported that after a successful link the page just sits in the browser (no bounce back into LINE, no OA add). Both link pages (`line/link-page`, `line/link-page/employee`) now inject the system OA deep link `https://line.me/R/ti/p/{basicId}` — basicId from `GET api.line.me/v2/bot/info` with `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`, cached per boot, fail-open to '' (page keeps old plain success message). On success: status "Linked. Opening LINE..." + `location.href` redirect after 800ms; employee page also un-hides an "Open LINE" fallback anchor. Prod/system OA = watchdog-bms `@557qmioh`. True auto add-friend at LINE Login consent still needs console config (not code): link OA to LINE Login channel 2010515251 (Basic settings > Linked OA, same provider) + LIFF app 2010515251-rvdZJ8la > Add friend option > On — user action, pending.

Verification (2026-07-07 post-link UX): api typecheck clean; local boot :3101 — employee page + web page both render `const oaAddUrl = "https://line.me/R/ti/p/%40557qmioh"` with the "Opening LINE" success branch and `open-line` anchor; POST /v1/auth/line/employee-link with bogus token still 403.

- 2026-07-07 deployed (2): commit `30094fd4`, image `ecs-api-web-30094fd4-20260707214813`, api-web-pub task-def :55 PRIMARY rollout COMPLETED (superseded a concurrent in-flight :54 from another session mid-bake — :55 built from the same tree plus this commit, nothing lost), canary no-rollback; prod verify: /v1/health 200 db ok, live employee link page renders the OA deep link + "Opening LINE" branch. User confirmed LINE console updated (Linked OA + LIFF Add friend option), so login consent now offers add-friend automatically.

- 2026-07-07 unlink→relink fix: preparing a round-2 test exposed that `link-line-identity` looked up only `status: ACTIVE` rows and then `create`d — but an UNLINKED row still owns the `@@unique([provider, providerChannelId, providerUserId])` slot, so ANY relink after `POST /v1/auth/line/unlink` died on the unique constraint (500). Now matches regardless of status: ACTIVE+same user = idempotent, ACTIVE+other user = 409, UNLINKED = reactivate in place (update userId/status/linkedAt — also covers moving a severed LINE account to another user), DISABLED = 403 (admin kill-switch, no silent resurrect; nothing sets DISABLED yet). New link-line-identity.use-case.spec.ts: 6/6, plus complete-employee-line-link 11/11; typecheck clean. Unlink endpoint is self-service (`account.identity.unlink`, in the base capability pack + ADMIN/OWNER), no web UI yet — call via fetch from a logged-in session.

Next: real-device pass — scan a QR, expect: consent shows add-friend → link success → bounces into the watchdog-bms OA chat; round-2 needs a FRESH QR (create a test employee from Settings > Employees, or system-onboarding regenerate — old QR token stays USED and its idempotent path requires the identity to still be ACTIVE); verify linked owner end-to-end (message the OA / check ExternalIdentity); browser-path verification of the two handoff screens; consider surfacing regenerate (password+QR) + unlink in UI (currently API-only).
