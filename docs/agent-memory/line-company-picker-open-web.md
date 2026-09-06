# Agent Memory: LINE บริษัทของฉัน — "เปิดเว็บบริษัทนี้" one-tap switch + web

Status: Implemented on `codex/line-company-picker-open-web` (branch pushed, no PR). Specs updated, unit +
local full-stack evidence recorded. Not deployed anywhere.

Owner: thawatchai (request 2026-09-06)

## Scope

Owner (verbatim): *"ในไลน์ rich บริษัทของฉัน เมื่อกดแล้ว ในแต่ละบริษัทที่ pop up ขึ้นมาอยากให้มี ปุ่ม กดไปเข้าเว็บด้วยบริษัทนั้นๆด้วย
เป็นทั้งการ switch และพาไปเว็บได้เลย ก็คือมี 2 ปุ่ม ปุ่มเลือก อันนี้ทำงานเหมือนเดิม คือเปลี่ยนบริษัทในไลน์ อีกปุ่มคือสลับบริษัทและพาไปเว็บไซต์ตามบริษัทนั้น"*

Each company bubble in the `/companies` picker gets:

1. `เลือกบริษัทนี้` — message action `/company <id>`, **unchanged**; typing the number still works.
2. `เปิดเว็บบริษัทนี้` — URI action on that company's own P12-3b handoff link
   (`<web>/l/<token>` → `/companies/<id>/dashboard`), one tap = switch the LINE chat **and** open the web
   signed in on that company.

The current company (`✓ ใช้งานอยู่`) gets only button 2. No schema change, no new dependency, no env/flag
change, no `package.json` edit.

## Decisions

- **The switch runs at exchange time, not at send time.** LINE never notifies the server that a `uri` button
  was tapped. `ExchangeLineHandoffTokenUseCase` upserts `LineCompanyContext` after the PENDING→USED claim and
  before issuing the session — after the claim, so a spent/expired/refused link cannot move the chat.
- **Scoped to one surface.** `LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN = 'company_picker_open_web'`, defined
  once in `apps/api/src/modules/auth/domain/logic/line-handoff.logic.ts`. Every other surface keeps today's
  behaviour: a notification deep link must never silently change which shop the chat is about.
- **Explicit minting, not the delivery seam.** The seam binds ONE recipient company per message and
  `isSafeHandoffPath` refuses a path under any other company. So `handleCompanyCommand` mints one token per
  VISIBLE bubble via `LineHandoffLinkService.linkFor(ctx, targetPath)` — a small public method added next to
  the private `handoffFor`, so the picker inherits the seam's enabled rule, its warn-and-degrade failure
  handling and its never-log-the-token guarantee instead of re-deriving them. (Task brief said "via
  `MintLineHandoffTokenUseCase`"; routing through the existing service is the same mint with no new DI and no
  duplicated flag rule.)
- **`companyPickerPage()` exported** from `line-staff-menu.logic.ts` and reused by `buildCompanyPickerMessage`,
  so the caller mints for exactly the bubbles the carousel shows and the page rule exists once.
- **`lineUserId` bound to `event.lineUserId`** (not `pushTargetId`), because that is the key
  `LineCompanyContext` is upserted under — the exchange must land on the row this conversation reads.
- **Feature off ⇒ byte-identical.** No `handoffLinks`, flag off, or a failed mint → no `webUrl` → the bubble
  renders exactly as before (`footer` gets `spacing: 'sm'` only when it holds more than one button, so the
  one-button footer is byte-identical too). A failed mint drops that bubble's web button only.
- **Context write is best-effort.** Failure logs `line_handoff_company_switch_failed`; the session still
  issues. The token is already spent by then — failing would cost the customer the page and give nothing back.
- Wording lives in constants (`COMPANY_PICKER_SELECT_LABEL`, `COMPANY_PICKER_OPEN_WEB_LABEL`,
  `COMPANY_PICKER_OPEN_WEB_HINT`) so a copy change is one line. Both labels are ≤ 12 Thai grapheme clusters.

## Production parity

`infra/prod-ecs-express/deploy.sh:135-137` sets `LINE_WEB_HANDOFF_ENABLED_INPUT=true` when the input is empty
with **no `DEPLOY_ENV` branch**, and `production-serving-mode.spec.sh:163-170` asserts there is no
production fail-closed block for it. Production already runs the handoff ON (P12 live 2026-08-30), so this
feature is live-on-arrival there; the maintenance serving mode still forces it off.

## Artifacts

- `apps/api/src/modules/auth/domain/logic/line-handoff.logic.ts` — surface constant.
- `apps/api/src/modules/auth/application/use-cases/exchange-line-handoff-token.use-case.ts` — step 4b +
  `switchLineCompanyContext`.
- `apps/api/src/modules/line-ai/application/line-handoff-link.service.ts` — `linkFor()`.
- `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts` — `CompanyPickerItem.webUrl`, the three
  label constants, `companyPickerPage()`, two-button `companyBubble`.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` — `companyPickerItems()`
  used by both list-branch picker sites.
- Specs: `line-staff-menu.logic.spec.ts`, `line-handoff-link.service.spec.ts`, `auth/line-handoff.spec.ts`,
  `process-line-webhook.use-case.spec.ts`.
- Docs: `docs/specs/line-rich-menu-v2-spec.md` §6.2 delta, `docs/specs/line-web-deeplink-handoff-spec.md` §11 delta.

## Verification

Red first, then green (`pnpm exec tsx --test` from `apps/api`):

| spec | red | green |
|---|---|---|
| `line-staff-menu.logic.spec.ts` | 47 pass / 3 fail | 50 / 0 |
| `line-handoff-link.service.spec.ts` | 17 / 3 | 20 / 0 |
| `auth/line-handoff.spec.ts` | 22 / 3 | 25 / 0 |
| `process-line-webhook.use-case.spec.ts` | 216 / 3 | 219 / 0 |
| `line-first-signup-webhook.spec.ts` (picker under a support pause) | 67 / 0 | 67 / 0 |

- `pnpm --filter @watchdog-bms/api typecheck` — clean.
- `spec-suite-coverage.spec.ts` + `line-intake-dispatch.use-case.spec.ts` — 186 pass / 0 fail.
- `node apps/api/scripts/check-di-metadata.mjs` — 795 files, 870 decorated classes, all carry paramtypes.
- Full API list (`pnpm test`, under `/tmp/mangmee-heavy.lock`) — 6911 tests, 6812 pass, 0 fail.

Mutations (each restored):

| mutation | result |
|---|---|
| drop `record.surface === …PICKER_OPEN` in the exchange (every link switches) | `auth/line-handoff.spec.ts` 23 / **2 fail** |
| drop `if (!this.enabled) return null` in `linkFor` | `line-handoff-link.service.spec.ts` 19 / **1 fail** |
| fall back to a plain `/companies/<id>/dashboard` URL when a mint fails | `process-line-webhook.use-case.spec.ts` 218 / **1 fail** |

### Local full-stack evidence (2026-09-06)

Docker postgres :15432, API `dist/dev-3021` on :3021 with `LINE_WEB_HANDOFF_ENABLED=true`, web dev on :3020,
LINE transport faked in-process (`--require` preload, see [[local-line-fake-harness]]). Seeded owner
`seed-local-owner` has 5 ACTIVE memberships, chat started on `seed-local-company`.

| step | result |
|---|---|
| `POST /v1/line/webhook` "/companies" | 200; reply = context card + 5-bubble carousel, `altText` unchanged |
| bubble 1 (`✓ ใช้งานอยู่`) | one button: `uri` `เปิดเว็บบริษัทนี้` → `http://127.0.0.1:3020/l/LeOF…` |
| bubbles 2–5 | `เลือกบริษัทนี้` (`/company <id>`) + `เปิดเว็บบริษัทนี้` (`/l/<token>`), both hint lines present |
| `LineWebHandoffToken` rows | 5, one per visible bubble, all `surface=company_picker_open_web`, `targetPath=/companies/<id>/dashboard` |
| `curl -i <web>/l/<Bloom token>` | `303` → `/companies/seed-local-company-2/dashboard`, `watchdog_token.*` + refresh + csrf + `watchdog_home` cookies set (`sub=seed-local-owner`, `provider=line`) |
| `LineCompanyContext` after | `seed-local-company` → **`seed-local-company-2`**, `aiPausedUntil` still null |
| audit after | `ai.line.company_context.switch`, SUCCESS/LOW, `{ surface: 'company_picker_open_web', lineUserId: '[REDACTED]' }` |
| second `curl` of the same link | `303` → `/login?line=handoff-expired&next=%2Fcompanies%2Fseed-local-company-2%2Fdashboard`, **no session cookies** |
| control: a `line_ai_reply` token for another company | `303` → that company's dashboard, chat **stayed** on `seed-local-company-2`, no new switch audit row |
| typing `3` after `/companies` | "🏢 เปลี่ยนบริษัทเป็น WEBTEST พนักงานหนึ่ง … แล้ว" — the numeric path is intact |
| restart with `LINE_WEB_HANDOFF_ENABLED=false`, resend `/companies` | 5 bubbles, current bubble has **no footer**, others one button; no `uri`, no `/l/`, no hint; **0 tokens minted** |

Servers stopped, scratch scripts removed, heavy lock released.

## Adversarial review 2026-09-06

Reviewed at `50acb25f`; 5 requested mutations all went red on the intended subtest (surface check 23/2,
switch-before-claim 24/1, `enabled` gate 19/1, plain-URL fallback 218/1, mint-every-membership 218/1).
Exchange-time switch traced clean: the row's `lineUserId`/`userId`/`companyId` are all server-written at
mint from the resolved LINE identity's own ACTIVE memberships, step 3 refuses a revoked membership BEFORE
the claim and the switch, and both `LineCompanyContext` readers (`resolveCompanyForLineUser`,
`exchange-liff-session`) re-verify the row against the CURRENT user's memberships — so a context written
for a LINE id that was relinked in the meantime degrades to `needsSelection`, never to another tenant's data.

Two fixes applied on top:

- The hint no longer renders on the `✓ ใช้งานอยู่` bubble — there it promised a switch that cannot happen.
- Both spec deltas now state the **stale-card outcome** (single-use + 15 min ⇒ an old card's web button
  opens `/login?line=handoff-expired&next=…` and does NOT move the chat, while `เลือกบริษัทนี้`/`ตอบ N`
  beside it never expire).

Reported, not fixed:

- The same carousel still renders WITHOUT web buttons at the three non-`list` sites
  (`process-line-webhook.use-case.ts:2897` text-lane needs-selection, `:4465` invalid selection,
  `:4810` media-lane needs-selection). Most visible at `:4465`: a mistyped number right after บริษัทของฉัน
  answers with the one-button card. Left alone on purpose — 2897/4810 would mint up to 12 tokens for every
  message from a multi-company user with no context, which is a cost the Owner request does not ask for.
- Write amplification: one บริษัทของฉัน tap now mints up to 11 `LineWebHandoffToken` rows and 11
  `AUTH_LINE_HANDOFF_ISSUE` (MEDIUM) audit rows, up from 0. Nothing anywhere deletes spent or expired
  handoff tokens — a pre-existing P12-3b gap this feature multiplies. Fine at current scale.
- `infra/prod-ecs-express/deploy.sh` comments claiming the handoff "stays production-off" / "fails closed"
  were stale since the 2026-08-30 parity decision; corrected (comment-only).

## Open questions

- None blocking.

## Next

- UAT deploy rides the next candidate — no flag or `deploy.sh` change needed (parity above).
- Owner acceptance: tap `เปิดเว็บบริษัทนี้` on a second shop in LINE and confirm the next LINE message is
  about that shop.
