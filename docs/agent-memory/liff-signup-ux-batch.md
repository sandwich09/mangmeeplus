# Agent Memory: liff-signup-ux-batch

Status: implemented on `codex/liff-signup-ux-batch`; API suite green; no PR opened (by instruction).

Owner: Owner UAT feedback 2026-09-05, from the LIFF signup form opened in LINE on iPhone.

Scope: the five UX decisions below, across the API-served LIFF pages only. No web app, no
infrastructure, no `package.json`, no pinned files.

## Decisions (Owner 2026-09-05)

1. **Phone is required** — supersedes the 2026-09-04 "ไม่บังคับ" decision and the Baymard evidence
   behind it (§14, now annotated as overridden). Label is bare "เบอร์มือถือ"; input carries
   `required` and `inputmode="tel"`.
2. **The 64-hex `displayChallenge` may not overflow** — it is legal evidence, so it wraps rather
   than truncating: its own block, monospace 12px, `overflow-wrap:anywhere; word-break:break-all`.
3. **Trial line drops "ไม่ต้องใส่บัตร"** → "ทดลองฟรี 30 วัน ให้ AI อ่านรูปได้ 15 ครั้ง".
4. **Card heading and body must not repeat each other** — the heading is "ได้รับแล้ว", so the body
   starts with what happens next.
5. **มั่งมี theme on every API-served LIFF page.**
6. **No empty message container may paint its own box** (follow-up from a second phone screenshot):
   `#detail` is the last element on the signup page, directly under the trial line, and carried a
   background, border and padding while holding nothing — a grey rounded box with no text in it.

## What changed

| Decision | Where |
|---|---|
| 1 client | `liff-page.security.ts` — `PHONE_TH` sentence, hard `^0[0-9]{9}$` gate before any fetch, `phoneNumber` always in the body, `PHONE_CODES` mapped back onto the same sentence |
| 1 page | `auth.controller.ts` `lineSignupPage` — label, `required`, `inputmode="tel"` |
| 1 DTO | `public-line-signup.controller.ts` — `@IsNotEmpty()`, `@IsOptional()` dropped, pattern kept as `*` so `@IsNotEmpty` is the rule that rejects `""` (and a mutation of it is detectable) |
| 1 server | new `requireThaiMobile` in `line-signup.logic.ts` → `submit-line-signup.use-case.ts` answers **400** `line_signup_phone_required` / `line_signup_phone_invalid`; everything else still 422 |
| 2 | `auth.controller.ts` — `.challenge` rule + its own `<p class="challenge">` block |
| 3 | `auth.controller.ts` — trial line |
| 4 | `liff-page.security.ts` — `done-text` and `pending-text`; `line-business-card.logic.ts` `buildSignupStatusCard` took the same edit, because its own comment promises the chat card and the LIFF page say the same three sentences |
| 5 | `liff-page.security.ts` — `LIFF_PAGE_STYLE` rewritten on the มั่งมี tokens, plus `MANGMEE_HEADER_HTML` (inline coin-with-sprout SVG + "มั่งมีพลัส"); `auth.controller.ts` signup styles moved onto the same tokens |
| 6 | `liff-page.security.ts` — `#status:empty,#detail:empty{display:none}` for the first paint, and `setStatus` now routes both containers through `setMessage`, which toggles `hidden` on the trimmed text |

`normalizeThaiMobile` was **not** changed: `account-profile.use-case.ts` uses its blank→null answer
to CLEAR a stored number. `requireThaiMobile` wraps it instead.

`sweepProfileGuardNudges` was **not** changed: it already filters `phoneNumber: null`, so a flow
that now always carries a phone simply stops matching. Spec §3.6 records that the day-7 card is
about email/password only for this source.

Decision 6 needs **both** halves. CSS `:empty` alone misses a message that is present but blank —
an `Error` carrying only whitespace is not `:empty`, so the box came back with nothing readable in
it. The `hidden` toggle alone misses the first paint, before the script has run. `setStatus` is the
single writer of both containers on all four pages, so the runtime half is one edit.

**Gotcha for the next editor:** `LIFF_PAGE_SCRIPT` is a `String.raw` template literal. A backtick in
a comment inside it terminates the template and the file stops compiling — write those comments
without backticks.

`LIFF_PAGE_CSP` is byte-for-byte unchanged — the logo is inline SVG, the type is the system stack,
so no new origin and no `img-src` edit were needed (`img-src 'self' data:` was already there).

## Verification

- `pnpm --filter @watchdog-bms/api test` — the fixed list, **7810 pass / 0 fail**, exit 0.
- `pnpm typecheck` (all six workspaces: config, contracts, api, ai-gateway, web, workers) — exit 0.
- `node infra/security/sync-production-maintenance-release-pins.mjs --check` — `exactFiles=45 status=current`.
- Mutation checks: removing `@IsNotEmpty` fails `LineSignupSubmitBodyDto — the phone is required`;
  replacing `requireThaiMobile(cmd.phoneNumber)` with `cmd.phoneNumber` fails 3 subtests of
  `SubmitLineSignupUseCase — identity and clickwrap`. Both restored.
- The 390px overflow is asserted from source (`.challenge` declarations + the arithmetic that says
  64 chars at 12px monospace is wider than the screen). A headless screenshot was attempted and
  abandoned: the browser pane renders a local file as a static snapshot it cannot drive or resize.

## Next

Nothing pending in code. A UAT deploy would be the next real check of the theme on a phone.
