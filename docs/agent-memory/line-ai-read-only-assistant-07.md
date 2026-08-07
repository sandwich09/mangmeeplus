# Agent Memory: line-ai-read-only-assistant-07

Status: COMPLETE / VERIFIED (2026-06-25); PHASE 1A EXTENDED IN PROGRESS (2026-06-25)
Owner: Codex
Scope: Master Implementation Checklist item 07. LINE AI read-only assistant across API webhook ingress, AI Gateway orchestration, ERP read tools, persistence/audit/idempotency, source refs, web deep links, config, and tests.

Role gate status:
- BA: Goal is safe Thai-first LINE Q&A for linked SME users. Target users are owner, admin, manager, sales, inventory, finance, accountant, marketing, staff, and auditor readonly. Journey: LINE text -> verified webhook -> linked user/company context -> AI Gateway -> permission-checked read tools -> concise answer with source labels/web link. Rules/exceptions: unlinked or unauthorized users get no business data; unsupported modules say not ready; mutation/export/final actions are refused and routed to web when useful. Acceptance: invalid signatures rejected, linked users can ask implemented inventory/dashboard/alert questions, source refs/deep links included, no final mutation from LINE.
- SA: Architecture fits item 01-06 primitives: API owns LINE webhook/raw signature/context/persistence, Auth owns LINE identity plus selected-company context, AI Gateway owns orchestration with no DB access, ERP source modules own read tools and repeat permission/ABAC checks, web owns guarded deep-link routes. Contracts are in `packages/contracts`; persistence uses Prisma `AiConversation`, `AiTurn`, `AiToolInvocation`, and `LineWebhookEventLog`; permissions require `line.ai.query` plus source permissions; state transitions cover webhook received/unlinked/forbidden/ai_error/completed and turn completed/refused/error. Scope excludes draft/final mutations, AI provider dependency, and new business modules beyond item 05/06. 2026-06-26 update: WatchDog shared LINE OA means company context must come from linked identity plus selected company context, not channel binding. LINE Login proves identity, webhook signature proves channel event, and active WatchDog membership/permission still gates authorization.
- DEV: Ponytail full read. Smallest correct diff completed missing hard gaps in existing partial item 07: raw-body HMAC, canonical `/v1/line/webhook` plus legacy path, Messaging channel identity mapping, fail-closed internal secret auth, `line.ai.query` grants/check, hash-only LINE event log, item 07 migration, source refs/deep links, tool invocation persistence, sensitive tool audit, low-stock tool priority, focused tests. Touched files include API/AI Gateway line-ai modules, auth LINE linking/webhook, contracts/config, Prisma schema/migration, package scripts, and env example.
- Integration: Backend-to-backend contract verified by API -> AI Gateway -> ERP tool types and tests. UI journey is deep-link handoff to existing guarded `/companies/[companyId]/...` web routes; no new web UI needed. Loading/error/permission states verified through LINE replies for invalid signature, unlinked, missing `line.ai.query`, forbidden/mutation/unsupported fallbacks, AI timeout fallback, and internal secret fail-closed tests. E2E/browser path not run because item 07 is LINE webhook/API flow; equivalent local verification uses signed webhook/controller tests plus full repo test/build.

Decisions:
- Keep deterministic-first AI behavior; no provider dependency required for item 07.
- Store LINE message preview plus hash only; webhook event stores `lineUserIdHash`, not raw LINE user id.
- Store LINE account linking under Messaging channel id for webhook/push lookup; LINE Login channel remains token-audience verification.
- Internal API <-> AI Gateway calls require `AI_GATEWAY_INTERNAL_SECRET`; production config fails without it.
- Generate LINE web links from trusted source refs using existing company-scoped web routes.
- Inactive or removed company membership fails closed immediately: no AI Gateway call, ERP tool call, upload/capture, alert detail, source refs, or business data in replies. Cached `LineCompanyContext`, old session, or old deep link does not bypass active membership.
- Subagent tools were available, but current tool policy requires explicit user request to spawn; role gates were emulated in main thread.

Open questions:
- None blocking item 07 closure.

Artifacts:
- `apps/api/src/modules/auth/presentation/line-webhook.controller.ts`
- `apps/api/src/modules/line-ai/`
- `apps/ai-gateway/src/modules/line-ai/`
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260625000000_item07_line_ai_read_only_assistant/migration.sql`
- `packages/contracts/src/line-ai.ts`
- `packages/contracts/src/ai-tools.ts`
- `packages/config/src/index.ts`
- `docs/plans/master-implementation-checklist.md`

Verification:
- `pnpm --filter @watchdog-bms/api exec prisma generate`: pass.
- `pnpm --filter @watchdog-bms/api typecheck`: pass.
- `pnpm --filter @watchdog-bms/api prisma:validate`: pass.
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`: pass.
- `pnpm --filter @watchdog-bms/contracts typecheck`: pass.
- `pnpm --filter @watchdog-bms/config test`: pass, 35/35. First sandbox run hit tsx IPC `listen EPERM`; escalated rerun passed.
- `pnpm --filter @watchdog-bms/ai-gateway test`: pass, 42/42. First sandbox run hit tsx IPC `listen EPERM`; escalated rerun passed.
- `pnpm --filter @watchdog-bms/api test`: pass, 197/197. Escalated because tsx IPC is sandbox-blocked.
- `pnpm typecheck`: pass, 10/10 tasks.
- `pnpm test`: pass, 10/10 tasks. Escalated because tsx IPC is sandbox-blocked.
- `pnpm build`: pass, 7/7 tasks.

Next:
- Phase 1A owner update: LINE OA/LIFF and web side chat share the AI Gateway pattern for read/report/sales-suggestion/accounting-evidence-capture only. AI approval/payment/posting/transfer/final mutation/broadcast remains blocked.
- Continue with verification after Phase 1A patch.

## Phase 1A Update: Read, Report, Suggest, Capture

Status: implemented and verified locally.
Owner: Codex
Scope: Extend existing item 07 plan/code so current phase supports business inquiry, reports, sales suggestions, and slip/receipt evidence capture while staying final-mutation blocked and AI-provider-key ready.

Role gate status:
- BA: Goal is omnichannel assistant through LINE OA/LIFF and web side chat. Target users are owner/admin/finance/accountant/sales/CRM users with permission-checked access. Journey: chat text or uploaded slip/receipt -> AI Gateway intent/tool policy -> ERP read/report/suggestion/evidence-capture tool -> source-aware answer or missing-field prompt. Rules/exceptions: no approval, payment, posting, transfer, order confirmation, export, permission change, or campaign broadcast through AI. Acceptance: report/sales/customer questions route to allowed tools; slip/receipt with attachment routes to capture; final actions still refused.
- SA: Architecture keeps agents server-side behind AI Gateway. Contracts add `report`, `suggestion`, and `evidence_capture` categories; `evidence_capture` is allowed only through ERP Core permission checks and does not enable `final_mutation`. Data model impact is provenance requirement for original file, extracted fields, confidence, user, timestamp, and audit metadata; existing expense/accounting modules own actual persistence. ABAC remains source-module-owned. Scope excludes direct Strands/browser execution and provider secrets in LIFF/web.
- DEV: Ponytail full read. Smallest correct diff updates existing contracts/config/intent selection/docs only; no new dependency or speculative agent runtime. Touched files: `.env.example`, `packages/config/src/index.ts`, `packages/contracts/src/line-ai.ts`, `packages/contracts/src/ai-tools.ts`, `apps/ai-gateway/src/common/config/ai-gateway-config.service.ts`, `apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-turn.logic.ts`, `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts`, `apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-turn.spec.ts`, and related docs.
- Integration: Backend contract remains API/web/LINE -> AI Gateway -> ERP tools. UI journey is unchanged: LINE OA/LIFF upload/chat and future web side drawer send server-side chat requests; loading/error/permission states rely on existing refused/forbidden/no-data replies plus capture missing-field behavior in ERP tool. E2E/browser not run because no web UI code changed in this patch; focused AI Gateway tests cover route/policy logic.

Decisions:
- Keep `AI_FINAL_MUTATION_ENABLED=false`; `evidence_capture` is allowed category but not final mutation.
- Add `OPENAI_API_KEY`, `OPENAI_MODEL`, `BEDROCK_REGION`, and `BEDROCK_MODEL_ID` config placeholders; production validation requires provider settings only when provider is selected.
- Do not add Strands SDK dependency in this patch; existing deterministic orchestration stays buildable without network/install, and provider/runtime can plug in behind current gateway boundary.

Open questions:
- None blocking skeleton readiness; actual provider choice remains `MODEL_PROVIDER=openai|bedrock` at deploy time.

Artifacts:
- `docs/plans/line-ai-read-only-assistant-plan.md`
- `docs/specs/line-ai-read-only-assistant-spec.md`
- `docs/specs/ai-gateway-agents-spec.md`
- `packages/contracts/src/line-ai.ts`
- `packages/contracts/src/ai-tools.ts`
- `packages/config/src/index.ts`
- `apps/ai-gateway/src/common/config/ai-gateway-config.service.ts`
- `apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-turn.logic.ts`
- `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts`
- `.env.example`

Verification:
- `pnpm --filter @watchdog-bms/contracts typecheck`: pass.
- `pnpm --filter @watchdog-bms/config typecheck`: pass.
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`: pass.
- `pnpm --filter @watchdog-bms/ai-gateway test`: pass, 47/47. First sandbox run hit tsx IPC `listen EPERM`; escalated rerun passed.
- `pnpm agent:gates -- docs/plans/line-ai-read-only-assistant-plan.md docs/agent-memory/line-ai-read-only-assistant-07.md`: pass.

Next:
- Add actual provider runtime/Strands SDK only when owner selects provider and allows dependency install; current code is key/config ready and deterministic fallback remains safe.

## LINE OA Webhook Local Agent Build Update

Status: implemented and verified locally (2026-06-25).
Owner: Codex
Scope: Make LINE OA webhook and AI Gateway agent skeleton local-run ready when `LINE_MESSAGING_CHANNEL_ID`, `LINE_MESSAGING_CHANNEL_SECRET`, `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`, and `AI_GATEWAY_INTERNAL_SECRET` are present.

Role gate status:
- BA: Goal is plug-in-ready LINE OA chat for linked users. Target users are linked WatchDog users using LINE OA. Journey: LINE OA webhook -> verified raw-body signature -> API user/company/permission context -> AI Gateway agent registry/tool orchestration -> LINE reply or safe refusal. Rules/exceptions: unlinked, missing permission, unsupported module, or final mutation gets no business data/final action. Acceptance: env placeholders exist, local services pass channel/internal secrets, every documented agent is visible for local build, and implemented agents can run without provider keys.
- SA: Architecture remains API-owned webhook + AI Gateway-owned orchestration + ERP-owned permission-checked tools. Contracts expose a stable `LINE_AI_AGENT_REGISTRY`; AI Gateway exposes local registry at `/v1/internal/ai/agents`; API returns `unsupported_module` for known tools whose source module is not wired rather than fake data. Data model unchanged. ABAC and final-mutation boundaries unchanged.
- DEV: Ponytail full read. Smallest diff reused existing contracts/controllers/config. Touched files include `.env.example`, `infra/docker/compose.local.yml`, `apps/api/package.json`, `apps/ai-gateway/package.json`, `packages/contracts/src/line-ai.ts`, `apps/ai-gateway/src/common/config/ai-gateway-config.service.ts`, `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts`, `apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts`, and focused specs. No new dependency.
- Integration: Backend-to-backend contract verified by build and smoke. Local Docker compose config parses with LINE/AI env bridge. Built AI Gateway `start` script serves health and agent registry on a temporary port. UI/browser path not run because no web UI changed; LINE webhook path is API/server-side.

Decisions:
- Keep local `MODEL_PROVIDER=disabled` by default; deterministic agent/tool routing runs without provider keys.
- Enable local `AI_GATEWAY_ENABLED=true` and `AI_AGENT_REGISTRY_ENABLED=true` in `.env.example`.
- Do not fabricate sales/CRM/tax/marketing data. Known unwired tools return `SOURCE_MODULE_NOT_READY` / `unsupported_module`.
- Fix package `start` paths to built `dist/apps/<service>/src/main.js`, matching Dockerfile output.

Artifacts:
- `GET /v1/internal/ai/agents` on AI Gateway returns `general`, `inventory`, `notifications`, `cfo`, `sales`, `crm`, `accounting`, `tax`, and `marketing`.
- LINE OA local env: `LINE_MESSAGING_CHANNEL_ID`, `LINE_MESSAGING_CHANNEL_SECRET`, `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`.
- Internal bridge env: `AI_GATEWAY_INTERNAL_URL`, `AI_GATEWAY_INTERNAL_SECRET`, `ERP_CORE_INTERNAL_URL`, `WEB_BASE_URL`.

Verification:
- `pnpm --filter @watchdog-bms/contracts typecheck`: pass.
- `pnpm --filter @watchdog-bms/config typecheck`: pass.
- `pnpm --filter @watchdog-bms/ai-gateway test`: pass, 49/49 after escalated rerun for tsx IPC `listen EPERM`.
- `pnpm --filter @watchdog-bms/api test`: pass, 282/282 after escalated rerun for tsx IPC `listen EPERM`.
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`: pass.
- `pnpm --filter @watchdog-bms/api typecheck`: pass.
- `pnpm --filter @watchdog-bms/contracts build`: pass.
- `pnpm --filter @watchdog-bms/config build`: pass.
- `pnpm --filter @watchdog-bms/ai-gateway build`: pass.
- `pnpm --filter @watchdog-bms/api build`: pass.
- `docker compose -f infra/docker/compose.local.yml --env-file .env.example config --quiet`: pass.
- Temporary built AI Gateway smoke on `127.0.0.1:3302`: `/v1/health` returned ok; `/v1/internal/ai/agents` returned 9 agents; port freed after stop.

Next:
- To use real LINE OA locally, copy `.env.example` to `.env`, fill LINE Messaging channel id/secret/access token, ensure account link/binding seed data exists, then expose `POST /v1/line/webhook` to LINE with a tunnel.

## LINE LIFF Retest After `LINE_LIFF_ID`

Status: verified locally (2026-06-25).
Owner: Codex
Scope: Retest LINE/LIFF local flow after root `.env` received `LINE_LIFF_ID`.

Role gate status:
- BA: Goal is confirm linked-user entry can start from LIFF and LINE OA webhook still accepts valid signed events. Target user is WatchDog user linking LINE then messaging OA. Journey: open `/v1/auth/line/link-page` -> LIFF init -> link -> send LINE message -> API webhook. Rules/exceptions: fake/unlinked smoke user does not expose business data; signed webhook must still 200.
- SA: Architecture unchanged: root `.env` feeds Docker compose API env; API owns LIFF page and LINE signature verification; AI Gateway registry stays separate on port 3002. No data model, permission, or state transition change.
- DEV: Ponytail full read. Smallest correct action was no code change; recreate API container so it reloads `LINE_LIFF_ID`. Touched files: none.
- Integration: Backend-to-backend contract checked through API health, AI Gateway health, internal agent registry, LIFF link page, and signed LINE webhook smoke. UI/browser path not run because smoke inspected served LIFF HTML and no web UI changed; real LIFF browser login still requires LINE client/tunnel.

Decisions:
- Recreated only `api`; AI Gateway did not need restart.
- Did not print secret values; checks report set/missing only.

Open questions:
- None blocking local retest.

Artifacts:
- Running containers: `docker-api-1` on `127.0.0.1:3001`, `docker-ai-gateway-1` on `127.0.0.1:3002`, `watchdog-line-tunnel-20260625`.

Verification:
- Root `.env`: `LINE_LIFF_ID`, LINE Login settings, LINE Messaging settings, and `AI_GATEWAY_INTERNAL_SECRET` are set.
- `docker compose -f infra/docker/compose.local.yml --env-file .env config --quiet`: pass.
- First smoke before API recreate: LIFF page did not include configured `LINE_LIFF_ID`, proving running container had stale env.
- `docker compose -f infra/docker/compose.local.yml --env-file .env up -d api`: pass; API recreated and started.
- API health `GET http://127.0.0.1:3001/v1/health`: 200, db ok.
- AI Gateway health `GET http://127.0.0.1:3002/v1/health`: 200.
- Agent registry `GET /v1/internal/ai/agents`: 200, 9 agents (`general`, `inventory`, `notifications`, `cfo`, `sales`, `crm`, `accounting`, `tax`, `marketing`).
- LIFF page `GET /v1/auth/line/link-page`: 200 and includes configured `LINE_LIFF_ID`.
- Signed LINE webhook smoke `POST /v1/line/webhook`: 200 with HMAC signature from configured Messaging channel secret; API log confirms request.
- `pnpm --filter @watchdog-bms/api test`: pass, 282/282 after escalated rerun for tsx IPC `listen EPERM`.
- `pnpm --filter @watchdog-bms/ai-gateway test`: pass, 49/49 after escalated rerun for tsx IPC `listen EPERM`.

Next:
- Open the tunnel LIFF/link URL from LINE client and complete real account link; smoke cannot validate LINE-hosted LIFF login outside LINE client.

## LIFF Link Page Cache Fix

Status: implemented and verified locally (2026-06-25).
Owner: Codex
Scope: Fix repeated mobile LIFF page showing stale `Dev token failed: 500` while current tunnel API returned 200.

Role gate status:
- BA: Goal is let user retry LINE account linking without stale webview state. Target user is local tester in LINE client. Journey: reopen LIFF link URL -> get current page -> dev token succeeds -> LIFF link continues. Rule/exception: local dev token remains local-only and no secrets are printed. Acceptance: tunnel link page is no-store and `/v1/auth/dev/token` returns 200.
- SA: Architecture unchanged; API owns LIFF link page and dev-token bootstrap in local env. Contract/data model/permissions/state unchanged.
- DEV: Ponytail full read. Smallest correct diff adds `Cache-Control: no-store, max-age=0` to LIFF link page response. Touched file: `apps/api/src/modules/auth/presentation/auth.controller.ts`.
- Integration: Rebuilt/recreated API container and verified public tunnel. Browser path not run; HTTP tunnel smoke verifies served header and dev token endpoint used by page.

Decisions:
- Keep existing LIFF page behavior; only prevent stale cached page.

Open questions:
- None.

Artifacts:
- `apps/api/src/modules/auth/presentation/auth.controller.ts`

Verification:
- `pnpm --filter @watchdog-bms/api test`: pass, 282/282.
- `pnpm --filter @watchdog-bms/api typecheck`: pass.
- `docker compose -f infra/docker/compose.local.yml --env-file .env up -d --build api`: pass.
- Tunnel `GET /v1/auth/line/link-page?fresh=<ts>`: 200 with `Cache-Control: no-store, max-age=0`.
- Tunnel `POST /v1/auth/dev/token`: 200.

Next:
- Retry LINE client with cache-busted URL: `/v1/auth/line/link-page?fresh=<timestamp>`.

## LIFF Absolute API Base Fix

Status: implemented and verified locally (2026-06-25).
Owner: Codex
Scope: Fix LINE webview still reporting `Dev token failed: 500` while server logs showed only link-page GETs and no failing dev-token POST from phone.

Role gate status:
- BA: Goal is make LINE link retry work from LINE webview, not only desktop/tunnel fetch. Target user is local tester in LINE client. Journey: open LIFF page -> page uses public tunnel API base -> dev token fetch reaches WatchDog API -> link continues. Rule/exception: local dev token remains local-only and debug shows URL/status for diagnosis. Acceptance: served page includes absolute tunnel API base and dev-token endpoint returns 200 through tunnel.
- SA: Architecture unchanged; API derives public base from forwarded proto/host for the request. Contracts, data model, permissions, and state transitions unchanged.
- DEV: Ponytail full read. Smallest correct diff replaced `location.origin + '/v1'` with server-rendered API base from forwarded host and added page version/error detail. Touched file: `apps/api/src/modules/auth/presentation/auth.controller.ts`.
- Integration: Rebuilt/recreated API container and verified tunnel-served HTML contains `20260625-absolute-api-base` and `https://ict-vast-ended-rental.trycloudflare.com/v1`. Browser path not run; HTTP tunnel smoke confirms the exact served page and dev-token endpoint.

Decisions:
- Use request-derived forwarded host instead of static env so Cloudflare quick-tunnel URL changes do not require `.env` edits.

Open questions:
- None.

Artifacts:
- `apps/api/src/modules/auth/presentation/auth.controller.ts`

Verification:
- `pnpm --filter @watchdog-bms/api typecheck`: pass.
- `pnpm --filter @watchdog-bms/api test`: pass, 282/282.
- `docker compose -f infra/docker/compose.local.yml --env-file .env up -d --build api`: pass.
- Tunnel `GET /v1/auth/line/link-page?fresh=<ts>`: 200, no-store, includes version marker and absolute tunnel API base.
- Tunnel `POST /v1/auth/dev/token`: 200.

Next:
- Reopen LINE link page with a new cache-busted URL and confirm debug detail shows `version=20260625-absolute-api-base` and `apiBase=https://ict-vast-ended-rental.trycloudflare.com/v1`.

## LIFF CORS Origin Fix

Status: implemented and verified locally (2026-06-25).
Owner: Codex
Scope: Fix browser/LINE webview `POST /v1/auth/dev/token` returning 500 when the request includes `Origin: https://*.trycloudflare.com`.

Role gate status:
- BA: Goal is let local tester link LINE through the public quick tunnel. Target user is owner/dev tester in browser or LINE client. Journey: LIFF page -> dev token bootstrap -> LINE link. Rule/exception: local tunnel origin is allowed only outside production. Acceptance: browser-origin token request through tunnel returns 200 and CORS echoes the tunnel origin.
- SA: Architecture unchanged. API CORS policy now allows `*.trycloudflare.com` only when `APP_ENV` is not production, while production still requires explicit `CORS_ALLOWED_ORIGINS`. Contracts, data model, permissions, and state transitions unchanged.
- DEV: Ponytail full read. Smallest correct diff adds a local-only `trycloudflare.com` CORS origin check in `apps/api/src/main.ts`. Touched file: `apps/api/src/main.ts`.
- Integration: Rebuilt/recreated API container and reproduced the exact browser-origin request. Browser path represented by tunnel request with `Origin` and `Referer` headers; real browser should now pass the same CORS gate.

Decisions:
- Do not add a fixed quick-tunnel URL to `.env`; quick tunnel changes often, so local-only suffix match is less brittle.

Open questions:
- None.

Artifacts:
- `apps/api/src/main.ts`

Verification:
- Before fix: tunnel/local `POST /v1/auth/dev/token` with `Origin: https://ict-vast-ended-rental.trycloudflare.com` returned 500.
- `pnpm --filter @watchdog-bms/api typecheck`: pass.
- `pnpm --filter @watchdog-bms/api test`: pass, 282/282.
- `docker compose -f infra/docker/compose.local.yml --env-file .env up -d --build api`: pass.
- After fix: tunnel `POST /v1/auth/dev/token?fresh=<ts>` with browser `Origin` and `Referer` headers returned 200 and `Access-Control-Allow-Origin: https://ict-vast-ended-rental.trycloudflare.com`.

Next:
- Retry the same LIFF page URL; the dev-token request should now pass CORS and return 200.

## LIFF Login Channel Id Fix

Status: configured and verified locally (2026-06-25).
Owner: Codex
Scope: Fix `/v1/auth/line/link` returning 401 `LINE Login token verification failed` after dev-token and CORS passed.

Role gate status:
- BA: Goal is allow LINE user to link WatchDog account via LIFF. Target user is local tester. Journey: LIFF issues ID token -> API verifies token against correct LINE Login channel -> link identity. Rule/exception: Messaging channel remains separate for webhook/push. Acceptance: API config uses LIFF channel id for LINE Login verification.
- SA: Architecture unchanged. LINE Login token verification must use the LIFF/Login channel id, while webhook identity binding still uses Messaging channel id. Data model, permissions, and state transitions unchanged.
- DEV: Ponytail full read. Smallest correct change updates root `.env` `LINE_LOGIN_CHANNEL_ID` from Messaging channel id to LIFF channel prefix. Touched file: `.env`.
- Integration: API container recreated and verified config. Browser path pending user retry because fresh LINE ID token is only available in user browser/LINE session.

Decisions:
- Keep `LINE_MESSAGING_CHANNEL_ID=2010514513`.
- Set `LINE_LOGIN_CHANNEL_ID=2010515251`, matching `LINE_LIFF_ID=2010515251-rvdZJ8la`.

Open questions:
- None.

Artifacts:
- `.env`

Verification:
- `docker compose -f infra/docker/compose.local.yml --env-file .env up -d api`: pass.
- Tunnel `GET /v1/health`: pass.
- Tunnel `GET /v1/auth/line/link-page?fresh=<ts>`: 200, `Cache-Control: no-store, max-age=0`.
- Container config check: `LINE_LOGIN_CHANNEL_ID=2010515251`, `LINE_LIFF_PREFIX=2010515251`, `LINE_MESSAGING_CHANNEL_ID=2010514513`.

Next:
- Retry LIFF link; if it still fails, inspect `/auth/line/link` response and LINE verifier error body.

## Tunnel Continuation After Password Change

Status: docs updated (2026-06-26).
Owner: Codex
Scope: Encode next real LINE path after user reached `/change-password` success screen and confirmed a tunnel already exists.

Role gate status:
- BA: Goal is move from web-password-ready state to real LINE AI onboarding. Target user is local tester/owner. Journey: password changed -> continue to dashboard for web access -> add shared LINE OA -> open tunnel-hosted account-link page -> complete LINE Login/LIFF -> send LINE message. Rules/exceptions: `localhost` is not valid for LINE callbacks; tunnel required for LINE platform/webview.
- SA: Architecture unchanged. Tunnel is transport only; API still verifies LINE signature and LINE Login, then resolves active WatchDog membership/permission before AI Gateway or ERP tools.
- DEV: Ponytail full read. Smallest diff updates specs/plan/memory only. Touched docs: LINE channel/auth spec, LINE AI spec, LINE AI plan, item 07 memory.
- Integration: Real browser/LINE path should use tunnel URL for `/v1/auth/line/link-page` and `/v1/line/webhook`. Verify signed webhook reaches API, linked active user reaches AI Gateway with server-derived context, and inactive/removed membership fails closed.

Decisions:
- With tunnel present, next action is not more local web setup. Continue from tunnel-hosted link page/LINE client.
- Password-changed web state is sufficient for dashboard; LINE AI remains gated by LINE OA add + account linking.

Verification:
- Pending real tunnel/LINE client run.

## Password Change LINE QR Handoff

Status: implemented locally (2026-06-26).
Owner: Codex
Scope: Change `/change-password` success state so the user immediately sees LINE QR codes and short links after changing the temporary password.

Role gate status:
- BA: Goal is remove the extra admin handoff step after password change. Target user is owner/employee with a new WatchDog account. Journey: change password -> scan LINE OA QR/open short link -> scan account-link QR/open short link -> continue dashboard or LINE. Rules/exceptions: web access is ready after password change, but LINE AI remains gated by LINE add + account linking. Acceptance: success screen shows QR and copyable short link for configured LINE OA and account-link URLs.
- SA: Architecture unchanged. Web route reads public/non-secret URL config from server env and falls back account-link URL to `https://liff.line.me/<LINE_LIFF_ID>` when available, then `NEXT_PUBLIC_API_BASE_URL + /auth/line/link-page`. LINE Developers LIFF endpoint remains the tunnel-hosted `/v1/auth/line/link-page`. No data model, permission, or auth contract change. LINE verification and active membership checks remain server-side.
- DEV: Ponytail full read. Smallest correct diff updates only the change-password route/page plus source docs/env example. Touched files: `apps/web/app/change-password/page.tsx`, `apps/web/src/features/auth/ChangePasswordPage.tsx`, `.env`, `.env.example`, LINE/platform docs, and this memory.
- Integration: Backend-to-frontend contract is env URL -> rendered QR/link. UI journey is password-change success -> QR/link cards -> dashboard CTA. Loading/error states for password form unchanged. Real LINE/browser tunnel verification still needs active public tunnel reachability from the test environment.

Decisions:
- Do not add a QR dependency. QR images are generated from the non-secret public link unless an explicit QR image URL is configured.
- Use `LINE_ACCOUNT_LINK_URL` for explicit account-link override; otherwise prefer the LIFF URL derived from `LINE_LIFF_ID`, then derive from `NEXT_PUBLIC_API_BASE_URL`.
- Local `.env` now points `LINE_ACCOUNT_LINK_URL` at `https://liff.line.me/2010515251-rvdZJ8la` because scanning the raw tunnel endpoint can reach LIFF/Login 400. The active Cloudflare tunnel link-page must be configured as the LIFF endpoint URL in LINE Developers.

Open questions:
- None.

Artifacts:
- `apps/web/app/change-password/page.tsx`
- `apps/web/src/features/auth/ChangePasswordPage.tsx`
- `.env`
- `.env.example`
- `infra/docker/compose.local.yml`
- `docs/specs/platform-environment-config-spec.md`
- `docs/specs/line-ai-channel-auth-spec.md`
- `docs/specs/line-ai-read-only-assistant-spec.md`
- `docs/plans/line-ai-read-only-assistant-plan.md`

Verification:
- `git diff --check -- apps/web/app/change-password/page.tsx apps/web/src/features/auth/ChangePasswordPage.tsx .env .env.example docs/specs/platform-environment-config-spec.md docs/specs/line-ai-channel-auth-spec.md docs/specs/line-ai-read-only-assistant-spec.md docs/plans/line-ai-read-only-assistant-plan.md docs/agent-memory/line-ai-read-only-assistant-07.md`: pass.
- `pnpm --filter @watchdog-bms/web typecheck`: blocked by pnpm non-TTY module purge prompt, then with `CI=true` blocked by `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
- `pnpm agent:gates -- docs/agent-memory/line-ai-read-only-assistant-07.md docs/plans/line-ai-read-only-assistant-plan.md`: blocked by the same pnpm lockfile overrides mismatch.
- `docker compose -f infra/docker/compose.local.yml --env-file .env restart web`: pass.
- `curl -fsS -o /tmp/watchdog-change-password.html -w '%{http_code}' http://127.0.0.1:3000/change-password`: 200.
- `docker ps --format ...`: API and AI Gateway healthy; web listening on `127.0.0.1:3000`.
- 2026-06-26 follow-up: user saw LINE `400 Bad Request` after scanning account-link QR. API logs showed `GET /v1/auth/line/link-page` returned 200, so 400 occurred after LIFF/Login handoff, not from WatchDog API. Fixed QR target to `https://liff.line.me/2010515251-rvdZJ8la`, passed LINE env into `web` service, and recreated web.
- `docker exec docker-web-1 env`: confirms `LINE_ACCOUNT_LINK_URL=https://liff.line.me/2010515251-rvdZJ8la`, `LINE_LIFF_ID=2010515251-rvdZJ8la`, `LINE_OA_ADD_URL=https://lin.ee/tayy5Vh`, and LINE QR image env are present.
- `curl -fsS http://127.0.0.1:3000/change-password`: rendered `lineAccountLinkUrl` as `https://liff.line.me/2010515251-rvdZJ8la`.
- `curl -fsS http://127.0.0.1:3001/v1/auth/line/link-page | head -20`: local API LIFF endpoint page returns HTML.
- Real LINE/browser tunnel smoke remains pending because public tunnel verification from this shell is blocked by proxy/DNS behavior.

## Shared LINE OA Company Context Gap

Status: IMPLEMENTED LOCALLY (2026-06-26). Containers rebuilt; awaiting real mobile LINE scan against active tunnel.
Owner: Codex
Scope: Capture real-test finding that shared LINE OA chat history remains the same and selected company must be persisted server-side.

Role gate status:
- BA: Goal is make company switching understandable and testable for a user who owns multiple companies but uses the same LINE account/OA chat. Target user is OWNER testing a new company. Journey: create/select company -> change password -> scan LINE OA/account-link -> link same LINE user -> send LINE message. Rules/exceptions: LINE chat history may stay old; WatchDog company context must change through server state only. Acceptance: same LINE user linked from selected new company updates `LineCompanyContext`, and latest webhook/audit rows show new `companyId`.
- SA: Architecture remains shared LINE OA. `ExternalIdentity` proves LINE user identity; `LineCompanyContext(lineUserId -> companyId)` stores selected company; webhook verifies active membership on every request. Original gap: `LinkLineIdentityUseCase` created `ExternalIdentity` but did not write `LineCompanyContext` or idempotently refresh context for the same user. Local DB also lacked `LineCompanyContext` until migration `20260626000004_item10a_shared_line_credential_and_line_company_context` was applied.
- DEV: Ponytail full read. Smallest correct code diff now wires selected company from the post-password LINE CTA into LIFF/account-link, validates selected company before creating `ExternalIdentity`, refreshes `LineCompanyContext` on same-user relink, and adds focused line-linking unit coverage.
- Integration: Real test evidence before implementation: `LineCompanyContext` query returned `0 rows`; `LineWebhookEventLog` returned `0 rows`; `ExternalIdentity` only had seed `providerUserId=dev-owner`; API logs did not show `POST /v1/auth/line/link` or `POST /v1/line/webhook`. Patch now makes the intended LIFF journey carry explicit `companyId`; full LIFF/webhook smoke still needs a runnable local app/test environment.

Decisions:
- Same LINE OA chat thread and old chat messages are expected; they are not company context.
- User-facing account-link QR should point to `https://liff.line.me/<LINE_LIFF_ID>`.
- LINE Developers LIFF endpoint should point to tunnel `/v1/auth/line/link-page`.
- Same WatchDog user + same LINE user relink must refresh `LineCompanyContext` and return success.
- Same LINE user linked to another WatchDog user must fail closed.

Open questions:
- None for the current patch. Route-derived `companyId` from `/companies/:companyId/dashboard` is the selected-company source for the post-password LINE CTA.

Artifacts:
- `docs/specs/line-ai-channel-auth-spec.md`
- `docs/specs/line-ai-read-only-assistant-spec.md`
- `docs/plans/line-ai-read-only-assistant-plan.md`
- `docs/agent-memory/line-ai-read-only-assistant-07.md`
- `apps/web/src/features/auth/ChangePasswordPage.tsx`
- `apps/api/src/modules/auth/presentation/auth.controller.ts`
- `apps/api/src/modules/auth/application/use-cases/link-line-identity.use-case.ts`
- `apps/api/src/modules/auth/line-linking.spec.ts`

Verification:
- `docker exec -it docker-postgres-1 psql -U watchdog -d watchdog_bms -c 'select ... from "LineCompanyContext" ...'`: before migration failed relation missing; after migration table existed but returned `0 rows`.
- `docker exec -it docker-postgres-1 psql -U watchdog -d watchdog_bms -c 'select ... from "LineWebhookEventLog" ...'`: `0 rows`.
- `docker exec docker-postgres-1 psql -U watchdog -d watchdog_bms -c 'select "userId","providerUserId"... from "ExternalIdentity"...'`: only seed `dev-owner`.

Decisions (implementation 2026-06-26):
- `LinkLineIdentityUseCase` accepts optional `companyId`; resolves auto from single membership when not provided.
- Same-user relink now idempotent: refreshes `LineCompanyContext`, returns `linked: true`.
- Multi-company users without explicit `companyId` skip context write; webhook prompts selection.
- Invalid `companyId` (no active membership) throws `ForbiddenException`.
- Multi-company non-OWNER users with explicit selected `companyId` fail closed; OWNER users can explicitly select among multiple companies.
- `ChangePasswordPage` appends selected route company to `LINE_ACCOUNT_LINK_URL` as `companyId`, and the LIFF link page forwards it in both body and `x-company-id`.
- Local LINE mobile webview cannot share WatchDog web `localStorage`; therefore local account-link QR also appends `watchdogUserId` from the current access token, and local-only `/auth/dev/token` accepts that user when the user has active membership.
- Old tunnel `https://ict-vast-ended-rental.trycloudflare.com` was stale/down during retest. New quick tunnel is `https://display-main-scales-rural.trycloudflare.com` -> local API `http://127.0.0.1:3001`.

Verification:
- `git diff --check -- apps/api/src/modules/auth/application/use-cases/link-line-identity.use-case.ts apps/api/src/modules/auth/presentation/auth.controller.ts apps/api/src/modules/auth/line-linking.spec.ts apps/web/src/features/auth/ChangePasswordPage.tsx`: pass.
- `CI=true corepack pnpm --filter @watchdog-bms/api test`: blocked before assertions because `apps/api/node_modules/tsx/dist/cli.mjs` is missing.
- `docker compose -f infra/docker/compose.local.yml --env-file .env up -d --build api web`: pass; API and web containers rebuilt with local LINE link patch.
- `docker exec docker-api-1 ... /v1/auth/dev/token { userId: 'cmqv2cl5i000201oe4h8t28p4' }`: 200, access token issued for explicit local test user.
- `docker exec docker-api-1 ... /v1/auth/line/link-page?...`: 200, page contains `watchdogUserId` and tunnel-derived `apiBase`.
- Public tunnel host probe from this shell hit local proxy/DNS limits (`Proxy CONNECT aborted` / Docker `ENOTFOUND`), but `cloudflared tunnel --url http://127.0.0.1:3001` is running and printed the new quick tunnel URL.

Files changed:
- `apps/api/src/modules/auth/application/use-cases/link-line-identity.use-case.ts`
- `apps/api/src/modules/auth/presentation/auth.controller.ts`
- `apps/api/src/modules/auth/line-linking.spec.ts`
- `apps/web/src/features/auth/ChangePasswordPage.tsx`
- `apps/web/app/change-password/page.tsx`
- `.env`

Next:
- Restore runnable `pnpm` workspace or run in a clean container, then rerun focused API tests.
- Real LIFF + webhook verification through the tunnel: password change screen -> scan account-link QR -> `/auth/line/link` -> `LineCompanyContext` row changes -> LINE webhook resolves the selected company.
- Item 11 Thai Tax MVP.

## LINE AI Reply Quality, Receipt Capture, and Out-of-Scope Guard

Status: implemented locally (2026-06-27).
Owner: Codex
Scope: Fix observed LINE AI behavior where free chat like weather questions routed to dashboard data, accounting replies were terse/mixed English, and uploaded bill/receipt images could fail to give a useful capture/authenticity response.

Role gate status:
- BA: Goal is Thai-first LINE replies that are understandable and honest. Target users are linked LINE OA users uploading slips/bills or asking business questions. Journey: text/image -> classifier/orchestrator -> safe tool path -> reply that says whether evidence was accepted, saved, needs review, or is outside system scope. Rules/exceptions: unrelated questions such as weather must not return dashboard/ledger data; bill/receipt capture must not claim final approval/posting/payment; authenticity must not claim pass/fake without supported signals. Acceptance: unknown chat is refused with reason, receipt attachment replies with review guidance when OCR/risk tools are unavailable, and accounting summary wording is Thai-readable.
- SA: Architecture remains API webhook -> AI Gateway -> ERP tools for text; LINE image/file receipt uploads use API `executeReceiptUpload` path first, then save expense evidence directly. Data model unchanged. Permission/ABAC remains ERP-owned. Classifier now returns `unknown` for text outside business keywords; `unknown` maps to safe `unsupported_module` refusal. Attachments still force `capture_accounting_evidence` before mutation keyword checks; text-only payment/transfer requests remain blocked. Receipt authenticity returns `UNSUPPORTED` when no supported OCR/duplicate/risk signals exist instead of default low-risk.
- DEV: Ponytail full read. Smallest correct diff touched AI Gateway classifier, deterministic turn reply composer, orchestrator response composer, receipt authenticity agent, API receipt upload reply copy, LINE webhook controller await handling, focused specs, and lockfile repair needed for Docker build. No new dependency. Existing dirty worktree was preserved.
- Integration: Backend-to-frontend contract unchanged: LINE/web chat callers receive the same `LineAiTurnResponse` shape for text; LINE image/file upload replies through API now use Thai “saved as needs review” copy. UI journey is LINE OA reply text only. Loading/error/permission states remain existing refused/forbidden/error replies. E2E/browser path not run because no web UI changed; focused API/AI Gateway tests cover out-of-scope, receipt attachment, mutation-vs-bill ordering, reply composition, and webhook controller awaiting processing. Running Docker containers were rebuilt/recreated and inspected to confirm patched dist code is active.

Decisions:
- Unknown/off-topic chat uses safe refusal copy: WatchDog AI answers only connected business-system data.
- Receipt/bill upload with attachment always enters capture path first; text-only `pay this bill` remains mutation-blocked.
- When receipt OCR/draft/authenticity tools are not implemented or unsupported, reply must say evidence was received but not saved/verified and list fields user must check in web app.
- When actual LINE image/file receipt upload path saves an expense evidence record, reply must say “บันทึกหลักฐานแล้ว” but still “รอตรวจสอบ”; do not claim document authenticity or accounting correctness.
- Do not add OCR or vision dependency in this patch; real extraction requires backed ERP receipt tools.

Artifacts:
- `apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-turn.logic.ts`
- `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/receipt-authenticity.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-turn.spec.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/auth/presentation/line-webhook.controller.ts`
- `apps/api/src/modules/auth/line-webhook.controller.spec.ts`
- `pnpm-lock.yaml`
- `docs/agent-memory/line-ai-read-only-assistant-07.md`

Verification:
- `pnpm --filter @watchdog-bms/ai-gateway test`: initially blocked by sandbox network `EPERM` and then pnpm `ERR_PNPM_IGNORED_BUILDS`.
- `PNPM_CONFIG_OFFLINE=true PNPM_CONFIG_IGNORE_SCRIPTS=true pnpm --filter @watchdog-bms/ai-gateway test` with escalated execution: pass, 85 tests / 16 suites / 0 fail.
- Runtime finding after user rebuilt: `docker-ai-gateway-1` still contained old dist (`return 'read_summary'`, no `ใบกำกับภาษี`) because Docker rebuild was blocked by lockfile override mismatch.
- `CI=true corepack pnpm install --lockfile-only --no-frozen-lockfile --ignore-scripts`: restored lockfile `overrides` for pnpm 9 Docker frozen install.
- `docker compose -f infra/docker/compose.local.yml --env-file .env build ai-gateway`: pass.
- `docker compose -f infra/docker/compose.local.yml --env-file .env up -d ai-gateway`: pass; `docker-ai-gateway-1` healthy.
- `docker exec docker-ai-gateway-1 node -e ...`: patched dist verified with `unknown true`, `taxInvoice true`, and classifier ending in `return 'unknown'`.
- AI Gateway smoke via `docker exec docker-ai-gateway-1 node -e fetch(...)`: weather text returns refused `unknown` with Thai out-of-scope copy and no tools; bill attachment returns `capture_accounting_evidence` with `accounting.capture_receipt_evidence` and Thai review guidance.
- API receipt-upload path gap found: LINE image/file events bypass AI Gateway and used English `Receipt uploaded...`; patched API reply to Thai saved-as-needs-review wording.
- `docker compose -f infra/docker/compose.local.yml --env-file .env build api`: pass.
- `docker compose -f infra/docker/compose.local.yml --env-file .env up -d api ai-gateway`: pass; `docker-api-1` and `docker-ai-gateway-1` healthy.
- `docker exec docker-api-1 node -e ...`: patched API dist verified with `receiptThai true`, `oldEnglish false`.
- `CI=true corepack pnpm install --ignore-scripts`: restored local `node_modules` after lockfile repair command removed it.
- 2026-06-27 screenshot follow-up: real LINE weather message still produced ledger and `LineWebhookEventLog` rows at 18:36 UTC were stuck at `received` with no `AiTurn`, showing webhook processing returned before work completed or errors were observable.
- `apps/api/src/modules/auth/presentation/line-webhook.controller.ts` changed from fire-and-forget `void this.processWebhook.execute(...)` to `Promise.allSettled(tasks)` before returning 200; test added to ensure controller waits for text processing.
- `PNPM_CONFIG_IGNORE_SCRIPTS=true pnpm --filter @watchdog-bms/api test` with escalated execution: pass, 349 tests / 99 suites / 0 fail.
- `docker compose -f infra/docker/compose.local.yml --env-file .env build api`: pass after webhook await fix.
- `docker compose -f infra/docker/compose.local.yml --env-file .env up -d api ai-gateway`: pass; `docker-api-1` and `docker-ai-gateway-1` healthy.
- `docker exec docker-api-1 node -e ...`: patched webhook controller dist verified with `awaitAllSettled true`, `noFireForget true`.
- `docker exec docker-ai-gateway-1 node -e ...`: patched AI Gateway classifier still verified with `unknown true`.

Next:
- Implement backing receipt OCR/draft/risk ERP tools before claiming “บันทึกแล้ว” or “ผ่าน” from uploaded bills.
- Real LINE mobile smoke after services/tunnel are active: upload receipt image, ask weather/off-topic question, ask text-only payment request, confirm replies match this memory.

## LINE AI Model Router Runtime Enablement

Status: implemented locally (2026-06-27).
Owner: Codex
Scope: Fix local Docker runtime so LINE AI uses the existing agent/model orchestration path instead of always falling back to deterministic keyword routing.

Role gate status:
- BA: Goal is avoid brittle keyword-only intent handling for real LINE users. Target users are linked LINE OA users asking mixed Thai business and non-business questions. Journey: LINE text/image -> API -> AI Gateway -> model-backed intent router when provider is configured -> safe specialist/tool response or refusal. Rules/exceptions: deterministic routing remains only fallback/safety when provider output is unavailable; final mutation stays blocked. Acceptance: local compose passes orchestration flags into `ai-gateway`, and runtime config can enable model routing without code keyword additions.
- SA: Architecture already supports `LINE_AI_AGENT_ORCHESTRATION_ENABLED=true` in `LineAiTurnUseCase` and model routing in `IntentRouterAgent`; missing part was Docker env propagation. Contracts, data model, permissions/ABAC, and state transitions unchanged. Scope boundary: this does not remove deterministic fallback because it is still needed for provider failure and fail-closed safety.
- DEV: Ponytail full read. Smallest correct diff adds `LINE_AI_AGENT_ORCHESTRATION_ENABLED` and `LINE_AI_AGENT_RUNTIME` pass-through to `infra/docker/compose.local.yml`. No new dependency, no classifier expansion.
- Integration: Backend contract unchanged. Compose config now resolves `ai-gateway` with orchestration enabled and provider env from `.env`. UI journey remains LINE OA reply. E2E/browser not run because no web UI changed; focused AI Gateway tests verify orchestrator path and fallback behavior.

Decisions:
- Use model-backed router for local LINE AI when `.env` sets `LINE_AI_AGENT_ORCHESTRATION_ENABLED=true` and `MODEL_PROVIDER=openai|bedrock`.
- Keep deterministic classifier only as fallback/safety, not primary runtime for real local LINE tests.
- Do not keep adding Thai substring handlers for normal language questions; fix config/runtime first.

Artifacts:
- `infra/docker/compose.local.yml`
- `docs/agent-memory/line-ai-read-only-assistant-07.md`

Verification:
- `docker compose -f infra/docker/compose.local.yml --env-file .env config`: pass; `ai-gateway` resolves `LINE_AI_AGENT_ORCHESTRATION_ENABLED=true`, `LINE_AI_AGENT_RUNTIME=strands-local`, and `MODEL_PROVIDER=openai`.
- `PNPM_CONFIG_IGNORE_SCRIPTS=true pnpm --filter @watchdog-bms/ai-gateway test`: first sandbox run hit tsx IPC `listen EPERM`.
- `PNPM_CONFIG_IGNORE_SCRIPTS=true pnpm --filter @watchdog-bms/ai-gateway test` with escalated execution: pass, 86 tests / 16 suites / 0 fail.
- `docker compose -f infra/docker/compose.local.yml --env-file .env build ai-gateway`: pass.
- `docker compose -f infra/docker/compose.local.yml --env-file .env up -d ai-gateway`: pass; container recreated.
- `docker exec docker-ai-gateway-1 node -e ...`: env verified with orchestration true, runtime `strands-local`, provider `openai`, and key present without printing secret.
- `docker exec docker-ai-gateway-1 node -e ...`: dist verified with short Thai financial keyword removed, specific `งบการเงิน` keyword present, and `return 'unknown'` fallback active.
- AI Gateway smoke `POST /v1/internal/ai/line-turn` for `อากาศวันนี้เป็นยังไงบ้าง`: 200, Thai out-of-scope refusal, `intent=unknown`, `refused=true`, `toolsInvoked=[]`.

Next:
- Real LINE mobile smoke through active tunnel/OA to confirm LINE reply matches direct AI Gateway smoke.

## LINE AI Free-Form Refusal Reply Fix

Status: implemented and verified locally (2026-06-27).
Owner: Codex
Scope: Fix model-routed out-of-scope LINE questions returning permission-denied copy when the model gives a free-form refusal reason instead of the canonical `unsupported_module` enum.

Role gate status:
- BA: Goal is make off-topic questions understandable to LINE users. Target users are linked LINE OA users asking non-system questions such as weather. Journey: user asks weather -> model router returns UNROUTABLE -> response composer returns out-of-scope copy, not permission denial. Rules/exceptions: true permission denial still says no permission; mutation still says open web app. Acceptance: weather/off-topic response says outside system scope and invokes no ERP tools.
- SA: Architecture unchanged. AI Gateway still uses model router first when enabled; response composer now treats UNROUTABLE reasons as mutation, permission, or unsupported by category. Data model, contracts, permissions/ABAC, and state transitions unchanged. Scope excludes weather answering because WatchDog AI must not answer from outside business-system data.
- DEV: Ponytail full read. Smallest correct diff changes only `ResponseComposerAgent` UNROUTABLE fallback and focused orchestrator/composer specs. No new dependency.
- Integration: LINE/API contract unchanged. Direct AI Gateway smoke with the same Thai weather phrase returns `intent=unknown`, `refused=true`, `toolsInvoked=[]`, and Thai out-of-scope copy. Browser/E2E not run because no web UI changed.

Decisions:
- Free-form model refusal reasons default to unsupported/out-of-scope unless they explicitly mention `forbidden` or `permission`.
- Keep `permission_denied`/permission-like reasons mapped to forbidden.

Artifacts:
- `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts`
- `docs/agent-memory/line-ai-read-only-assistant-07.md`

Verification:
- DB finding before fix: latest `AiTurn` for `อากาศวัยนี้เป็นยังไงบ้าง` had `intent=UNKNOWN`, `refused=true`, and weather free-form refusal reason, but `replyPreview=🔒 คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้`.
- `PNPM_CONFIG_IGNORE_SCRIPTS=true pnpm --filter @watchdog-bms/ai-gateway test`: pass, 88 tests / 16 suites / 0 fail.
- `PNPM_CONFIG_IGNORE_SCRIPTS=true pnpm --filter @watchdog-bms/ai-gateway typecheck`: pass.
- `docker compose -f infra/docker/compose.local.yml --env-file .env build ai-gateway`: pass.
- `docker compose -f infra/docker/compose.local.yml --env-file .env up -d ai-gateway`: pass; container recreated.
- AI Gateway smoke `POST /v1/internal/ai/line-turn` for `อากาศวัยนี้เป็นยังไงบ้าง`: 200, Thai out-of-scope refusal, `intent=unknown`, `refused=true`, `toolsInvoked=[]`.

Next:
- Real LINE mobile smoke: ask the same weather phrase again and confirm reply matches direct AI Gateway smoke.

## LINE Receipt Upload No-Reply Fix

Status: implemented and verified locally (2026-06-27).
Owner: Codex
Scope: Fix LINE image/bill upload events that returned 200 to LINE but produced no user reply and left webhook rows stuck at `received`.

Role gate status:
- BA: Goal is every uploaded bill/receipt receives a LINE reply, even when save/extraction fails. Target users are linked LINE OA users sending image/file receipt evidence. Journey: image -> API receipt upload path -> download LINE media -> save evidence draft -> reply saved/needs-review, or reply temporary error and mark event failed. Rules/exceptions: old LINE reply tokens cannot be reused after the fact; user must resend image after fix. Acceptance: receipt upload exceptions no longer leave silent `received` rows, and local DB has expense tables required by the upload path.
- SA: Architecture note: image/file events bypass AI Gateway and go through API `executeReceiptUpload`. Root cause was twofold: local DB schema lacked item 09 expense/receipt tables, and receipt upload path had no top-level catch, so exceptions after attachment intent creation left `AttachmentObject` as `PENDING_UPLOAD`, no `AttachmentLink`, and webhook status `received`. Data model synced locally via Prisma schema; permissions/ABAC unchanged.
- DEV: Ponytail full read. Smallest correct diff wraps `executeReceiptUpload` in fail-safe error handling that logs, replies with temporary error, and marks `receipt_upload_error`; focused API spec added. Local dev DB synced with `prisma db push` and seed. No new dependency.
- Integration: Backend LINE webhook contract unchanged. Verified latest failed state before fix: image events at 19:12 UTC were `received`, attachments were `PENDING_UPLOAD`, and expense tables were missing. After fix, API container rebuilt/recreated, DB has `ExpenseRecord`, `ExpenseCategory`, `ReceiptExtraction`, `ReceiptAiVerification`, and `ExpenseDuplicateCandidate`; health is ok. Real LINE resend still needed because old reply tokens expire.

Decisions:
- Do not send no-op success when receipt save fails; reply temporary error and mark webhook `receipt_upload_error`.
- Keep successful receipt reply as saved evidence + needs review, not document authenticity/accuracy approval.
- Use local `prisma db push` only to repair the dev database; source migration gap for item 09 remains a follow-up if production migrations are required.

Artifacts:
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`
- `docs/agent-memory/line-ai-read-only-assistant-07.md`

Verification:
- DB finding before fix: latest LINE image events had status `received` with no `companyId`/`processedAt`; `AttachmentObject` rows were created as `PENDING_UPLOAD`; `AttachmentLink` was empty; expense tables were absent from local DB.
- `PNPM_CONFIG_IGNORE_SCRIPTS=true pnpm --filter @watchdog-bms/api test`: pass, 350 tests / 99 suites / 0 fail.
- `DATABASE_URL=postgresql://watchdog:...@127.0.0.1:15432/watchdog_bms?schema=public pnpm --filter @watchdog-bms/api exec prisma db push`: pass; local DB schema synced.
- `DATABASE_URL=postgresql://watchdog:...@127.0.0.1:15432/watchdog_bms?schema=public pnpm --filter @watchdog-bms/api exec prisma db seed`: pass.
- `docker compose -f infra/docker/compose.local.yml --env-file .env build api`: pass.
- `docker compose -f infra/docker/compose.local.yml --env-file .env up -d api`: pass.
- `docker exec docker-postgres-1 psql ...`: expense/receipt tables exist.
- `docker exec docker-api-1 node -e ... /v1/health`: 200, db ok.
- `docker exec docker-api-1 node -e ...`: API dist has `LINE receipt upload error` and `receipt_upload_error` strings.

Next:
- User resends bill/receipt image in LINE; expected reply is either saved-as-needs-review or temporary error with webhook status not stuck at `received`.

## LINE Model-First Feature Match Routing Fix

Status: implemented and verified locally (2026-06-27).
Owner: Codex
Scope: Change model-routed LINE text handling so the model matches user input against enabled/disabled feature tools first, blocks disabled tools before ERP invocation, and avoids misleading "ไม่พบข้อมูลบัญชี" when the real issue is feature/tool readiness.

Role gate status:
- BA: Goal is clear LINE replies for users asking business questions such as revenue or expenses. Journey: user asks a business topic -> model matches closest feature/tool -> enabled feature fetches facts; disabled/unwired feature says not enabled/ready; no-match says outside supported system scope. Acceptance: revenue/sales no longer falls back to ledger/accounting no-data copy, while expense still uses `expense.list_recent`.
- SA: Architecture unchanged: AI Gateway Orchestrator -> IntentRouterAgent -> specialist agents -> ERP tools. Router now sends enabled/disabled tool catalog to the model and validates requiredTools against the enabled set. Data model and permissions unchanged. Current enabled model-route tool set mirrors wired InternalToolsController tools; sales/CRM/receipt-capture text tools remain disabled until backend adapters exist.
- DEV: Ponytail full read. Smallest correct diff updates router prompt/payload/validation, response copy for `feature_disabled`, accounting unsupported-module summary, focused tests, and this memory. No new dependency.
- Integration: LINE/API contract unchanged. Backend-to-frontend path unchanged. Browser/E2E not run because no web UI changed. Focused AI Gateway tests cover disabled provider, disabled feature routing, expense read routing, and sales/revenue not falling back to ledger/accounting.

Decisions:
- Model is source for semantic feature match when provider is enabled, but executable tools are still constrained by an explicit enabled tool catalog.
- Disabled or unknown tool selection becomes `feature_disabled` before ERP calls.
- `unsupported_module` from a specialist means feature/tool not ready, not empty business data.

Artifacts:
- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/accounting-summary.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.spec.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts`
- `packages/contracts/src/line-ai.ts`
- `docs/agent-memory/line-ai-read-only-assistant-07.md`

Verification:
- `corepack pnpm --filter @watchdog-bms/ai-gateway test -- src/modules/line-ai/agents/intent-router.agent.spec.ts src/modules/line-ai/agents/orchestrator.agent.spec.ts`: first sandbox run failed with `listen EPERM` on tsx IPC pipe.
- Same command with escalated execution: pass, 82 tests / 15 suites / 0 fail.
- `git diff --check -- apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.spec.ts apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts apps/ai-gateway/src/modules/line-ai/agents/accounting-summary.agent.ts packages/contracts/src/line-ai.ts`: pass.

Next:
- Real LINE smoke: ask `รายได้` and confirm reply says feature not enabled/ready; ask `ค่าใช้จ่าย` and confirm it routes to recent expense facts or empty expense list, not receipt capture without attachment.

## LINE Text Expense Model Routing Fix

Status: implemented and verified locally (2026-06-27).
Owner: Codex
Scope: Stop API-side text keyword capture from creating receipt/expense drafts before the AI Gateway model router sees the message. Text messages now go through `line.ai.query` and AI Gateway model feature matching; media receipt uploads still use the receipt upload path.

Role gate status:
- BA: Goal is `ค่าใช้จ่าย` text in LINE shows expense list behavior, not receipt draft creation. Target users are linked LINE users asking finance questions. Journey: text message -> company/permission resolution -> AI Gateway model router -> enabled expense list tool or clear feature-disabled/no-match reply. Rules/exceptions: image/file receipt uploads still create review drafts; text-only receipt notes require LINE AI permission and model routing. Acceptance: API no longer creates text-only receipt drafts from keyword text before model routing.
- SA: Architecture boundary restored: API webhook owns identity, company context, permissions, reply/persistence; AI Gateway owns text intent/feature matching. Contracts/data model unchanged. Permissions use existing `line.ai.query` for text AI; receipt upload permissions remain for media upload.
- DEV: Ponytail full read. Smallest correct diff removed API `LINE_CAPTURE_KEYWORDS`, `isLineExpenseCaptureText`, `executeReceiptTextCapture`, and `CreateExpenseDraftUseCase` injection from text webhook path; added model feature descriptions in AI Gateway catalog and focused tests. No new dependency.
- Integration: Backend LINE text contract unchanged, but route now passes text to AI Gateway. Browser/E2E not run because no web UI changed. Docker rebuild/restart pending after this memory update.

Decisions:
- Do not hard-code text keyword capture in API for LINE text messages.
- Let model router choose between `expense.list_recent`, disabled capture, unsupported, or other enabled tools from catalog.
- Keep media receipt uploads outside this text path because attachments are explicit evidence events.

Artifacts:
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`
- `docs/agent-memory/line-ai-read-only-assistant-07.md`

Verification:
- `corepack pnpm --filter @watchdog-bms/api test -- src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`: first sandbox run failed with `listen EPERM` on tsx IPC pipe.
- Same command with escalated execution: pass, 359 tests / 100 suites / 0 fail.
- `corepack pnpm --filter @watchdog-bms/ai-gateway test -- src/modules/line-ai/agents/intent-router.agent.spec.ts src/modules/line-ai/agents/orchestrator.agent.spec.ts` with escalated execution: pass, 83 tests / 15 suites / 0 fail.
- `docker compose -f infra/docker/compose.local.yml --env-file .env build api ai-gateway`: pass after adding `feature_disabled` formatter copy.
- `docker compose -f infra/docker/compose.local.yml --env-file .env up -d api ai-gateway`: pass; both services healthy.
- Direct AI Gateway smoke for `ค่าใช้จ่าย`: 200; `toolsInvoked=["expense.list_recent"]`; reply `ไม่พบรายการค่าใช้จ่ายที่พร้อมแสดง...`; no receipt draft/capture copy and no `ข้อมูลบัญชี` fallback.

Next:
- Real LINE smoke `ค่าใช้จ่าย` should go to model-routed expense listing instead of receipt draft reply.

## LINE Expense Summary Reply Fix

Status: implemented, verified, rebuilt, and service restarted (2026-06-27).
Owner: Codex
Scope: Change LINE `ค่าใช้จ่าย` answer from recent-row listing to AI-routed expense summary amounts: total, draft, confirmed, paid, unpaid.

Role gate status:
- BA: Goal is concise expense summary in LINE for linked finance users. Journey: user asks expense -> AI router selects `expense.list_recent` -> ERP tool returns permission-checked summary -> LINE reply shows only five totals. Rules/exceptions: AI still handles routing; no mutation/approval/payment through LINE. Acceptance: reply does not expose raw expense ids or per-row list.
- SA: Architecture unchanged. API ERP tool still uses `ListExpensesUseCase` with server-derived permissions/ABAC, then computes summary from returned expense records. AI Gateway `AccountingSummaryAgent` formats `summary` facts. Data model and permissions unchanged.
- DEV: Ponytail full read. Smallest correct diff updates expense ERP tool summary payload, AI Gateway formatter, focused orchestrator test expectation, and this memory. No new dependency.
- Integration: Backend-to-AI contract now includes `data.summary` for `expense.list_recent`. Web UI unchanged. Docker images rebuilt, `api` and `ai-gateway` restarted, health endpoints are ok, and internal ERP tool smoke returns the summary shape.

Decisions:
- Do not block `ค่าใช้จ่าย`; keep model/AI routing active and summarize tool output.
- Return amounts only: `ยอดทั้งหมด`, `ร่าง`, `ยืนยันแล้ว`, `จ่ายแล้ว`, `ยังไม่จ่าย`.
- Summary source link points to expenses page, not individual expense rows.

Artifacts:
- `apps/api/src/modules/line-ai/application/use-cases/erp-tools.use-case.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/accounting-summary.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts`
- `docs/agent-memory/line-ai-read-only-assistant-07.md`

Verification:
- Initial sandbox tests failed with `listen EPERM` on tsx IPC; escalated focused tests passed.
- `./node_modules/.bin/tsx --test src/modules/line-ai/agents/orchestrator.agent.spec.ts` from `apps/ai-gateway`: pass, 14 tests / 1 suite / 0 fail.
- `./node_modules/.bin/tsx --test src/modules/line-ai/presentation/http/internal-tools.controller.spec.ts` from `apps/api`: pass, 2 tests / 1 suite / 0 fail.
- `git diff --check -- apps/api/src/modules/line-ai/application/use-cases/erp-tools.use-case.ts apps/ai-gateway/src/modules/line-ai/agents/accounting-summary.agent.ts apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts docs/agent-memory/line-ai-read-only-assistant-07.md pnpm-lock.yaml`: pass.
- `CI=true corepack pnpm install --no-frozen-lockfile`: pass with pnpm 9.15 to align lockfile with Docker.
- `docker compose -f infra/docker/compose.local.yml --env-file .env build api ai-gateway`: pass after one transient network retry.
- `docker compose -f infra/docker/compose.local.yml --env-file .env up -d api ai-gateway`: pass; both containers healthy.
- `curl -fsS http://127.0.0.1:3001/v1/health`: `{"service":"api","status":"ok",...,"db":"ok"}`.
- `curl -fsS http://127.0.0.1:3002/v1/health`: `{"service":"ai-gateway","status":"ok",...}`.
- Internal ERP tool smoke `expense.list_recent`: 200 ok; returns `data.summary.totalAmount`, `draftAmount`, `confirmedAmount`, `paidAmount`, `unpaidAmount`, and source ref `/companies/<companyId>/expenses`.

Next:
- Real LINE smoke with provider-enabled AI: ask `ค่าใช้จ่าย`; expected reply has only five totals and no raw expense ids.
