# Agent Memory: LINE message links open the web page signed in

Status: implemented and merged to `main` and `develop` on 2026-10-07 by the owner's word. NEVER deployed: the Production hotfix run of 2026-10-06 14:24 stopped in its first phase (`productionMutated` false) and the cloud environment was shut down afterwards. Not proven by a real LINE turn.
Owner: thawatchai (decision in chat, 2026-10-06 ~14:10 Bangkok).
Scope: every web link the system sends in a LINE message (card buttons and links in text) that points
at a page inside a company (`<web>/companies/<id>/…`).

## Problem (owner's screen recording, iPhone, 2026-10-06 15:50 on the device clock)

Tapping "ตรวจสอบและยืนยันในเว็บ" on the receipt card opened Safari, the web found no session, started
LINE Login by itself, and LINE's own page answered "ไม่สามารถเข้าสู่ระบบได้" with an e-mail and password form.

Cause, read from the serving code:

- The 15-minute sign-in link (`/l/<token>`, P12-3b) is deliberately NOT put into messages that go
  through the stored-delivery path (`LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED`, default on since
  mid-September): a replay lands later than the token lives. So `process-line-webhook` skips the wrap,
  and the capture-result notifier's prepared path saves its plan before the wrap. The receipt card and
  the assistant's answers therefore left with a plain link.
- A plain link meets the login wall in Safari; the wall's automatic LINE Login (R-B5) did not complete
  on the owner's iPhone. Why LINE's page refused was not established.

## Decisions

- Owner: "ทำทาง ก เลย อนุญาตให้ทำกับทุกการ์ดทุก scenario" — the link goes through the LIFF start page,
  which proves who tapped and mints the sign-in link AT the tap. No token sits in a chat or a stored
  plan, and a card of any age opens.
- One rewrite at the existing exit, not per card: `withLineExternalBrowserParam`
  (`packages/contracts/src/line-external-browser.ts`) turns a company page into
  `https://liff.line.me/<LIFF id>/start?to=<path>`. Every send boundary already passes through it
  (reply adapter, delivery plan v2 freeze, system push, dashboard notifications), and it stays
  deterministic and idempotent, so retry keys and frozen plans keep one byte sequence.
- Configured once in `AppConfigService` from `LINE_WEB_HANDOFF_ENABLED`, `WEB_BASE_URL`, `LINE_LIFF_ID`.
  Any of them missing: links stay exactly as before (plain + `openExternalBrowser=1`).
- Not rewritten: `/l/<token>` links, pages outside `/companies/`, other origins.
- `POST /v1/auth/line/liff/session` accepts `to`. The path names its own company; it is accepted only
  when the token's user is an active member of it, and only as a path `isSafeHandoffPath` accepts.
  A locked shop still lands where `resolveLineHandoffTarget` sends it. Anything else in `to` is ignored
  and the tap is an ordinary start. Surface recorded on the token: `liff_open`.
- A LINE account that cannot be signed in (not linked, not a member, suspended) gets `fallbackUrl`:
  the same page through the web's own login, as before this change.
- The start page with `to` opens the link by itself (the tap in the chat was the gesture) and closes
  itself when LINE comes back to the front. The "เปิดหน้าเว็บ" button stays as the second way.
- Dropped: changing the web login wall for iPhone. With this change a LINE link no longer reaches the
  wall, and there is no proof a tap-first wall would make LINE's page behave differently.

## Open questions

- Not proved on a device: that LINE opens the outside browser from the start page with no tap.
  If it does not, the customer sees the start page with one button — two taps, no login.
- LINE for desktop opens `liff.line.me` links in the computer's browser, where LIFF asks for a LINE
  sign-in on first use. Not tried.

## Artifacts

- `packages/contracts/src/line-external-browser.ts` (+ spec)
- `apps/api/src/common/config/app-config.service.ts`
- `apps/api/src/modules/auth/application/use-cases/exchange-liff-session.use-case.ts`
- `apps/api/src/modules/auth/presentation/auth.controller.ts`
- `apps/api/src/common/security/liff-page.security.ts`
- specs: `apps/api/src/common/security/liff-start-handoff.spec.ts`, `apps/api/src/modules/auth/line-liff-signup.spec.ts`

## Verification

- `packages/contracts` `line-external-browser.spec.ts`: 6/6.
- `apps/api` `liff-start-handoff.spec.ts`: 15/15; `line-liff-signup.spec.ts`: 86/86.
- `pnpm typecheck` in `packages/contracts` and `apps/api`: clean.
- `node scripts/run-line-ai-whole-chain-acceptance.mjs`: exit 0, no failing test (2026-10-06 ~14:50 Bangkok).

## Next

- Production hotfix on the owner's word ("เสร็จแล้ว hotfix ขึ้น prod เลย"). Blocked at the time of writing
  by Production operation `20261005T180652Z-3f9b6aa1` (another session's hotfix of #1043), which has
  served since 01:18 and still waits for the owner's browser acceptance.
- After it ships: one real tap on an iPhone and one on Android; carry the change to `develop`.
