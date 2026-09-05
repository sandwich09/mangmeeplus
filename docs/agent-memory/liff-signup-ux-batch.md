# Agent Memory: liff-signup-ux-batch

Status: implemented on `codex/liff-signup-ux-batch`; API suite green; no PR opened (by instruction).

Owner: Owner UAT feedback 2026-09-05, from the LIFF signup form opened in LINE on iPhone.

Scope: the eleven UX decisions below, across the five API-served LIFF pages only. No web app, no
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
| 1 client | `liff-page.security.ts` — hard `^0[0-9]{9}$` gate before any fetch, `phoneNumber` always in the body; the copy and the server-code mapping were folded into `SIGNUP_GUIDANCE` in round 4 below |
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
single writer of both containers on every page, so the runtime half is one edit.

## Round 4 — tones, guidance and the review findings (2026-09-05)

Owner: *"warning สีเหลือง / ส่งไม่สำเร็จสีแดง พร้อมคำแนะนำว่าอะไรผิดด้วย ... เอาให้คนชอบ"*.

7. **`setStatus(text, detail, tone)`** paints `#status` as a tinted notice box (info/success/
   warning/error) at 16px in the page's own Thai face, with the advice on a second line via
   `white-space:pre-line` — no markup, so every existing `textContent` assertion still holds.
   `#detail` keeps its old job: technical text only.
8. **Field-level errors.** `#<input-id>-error` under the input, `aria-invalid="true"`, `focus()`.
   This is the review's BLOCKER 1: the phone message used to be thrown as a bare `Error`, so it
   landed in the summary at the top (scrolled away) and `#detail` at the bottom (below the fold) —
   off-screen in both directions at the moment of the tap. A client-side failure now also stops
   claiming "ส่งคำขอไม่สำเร็จ", because nothing was submitted.
9. **Guidance map** keyed on the codes the server *actually* answers with. `line_signup_identity_disabled`
   and `line_signup_account_blocked` were named in the brief but **do not exist anywhere on this
   path** — they were not added; unknown codes fall to the generic error copy and the raw code is
   never shown to a customer.
10. **Contrast (review SHOULD-FIX 2).** White on `--brand` #22C55E is 2.28:1 and failed AA on the
    submit button, every `a.btn` and the header bar. All three now use `--brand-dark` #15803D
    (5.02:1); #22C55E survives only as the success notice's left rule, where no text sits on it.
    `liff-page-contrast.spec.ts` *computes* the ratios rather than pinning hexes.
11. **Fifth LIFF page (review SHOULD-FIX 3).** `crm-inbox`'s `customer-register-page` built its own
    HTML with the pre-theme stylesheet and no `:empty` rule. Migrated onto `liffPageHtml`; its
    existing security spec (2 external scripts, CSP, escaping, `#liff-content`) passes unchanged,
    and every id and every string of customer-facing copy is identical. Its PDPA notice opts out of
    the shared `pre` rule via `.consent-notice` so long-form legal text stays at reading size.

**Gotcha for the next editor:** `LIFF_PAGE_SCRIPT` and `LIFF_PAGE_STYLE` are both template
literals. A backtick in a comment inside either one terminates the template and the file stops
compiling — write those comments without backticks. This cost two build failures in this batch.

Every LIFF page is now built by `liffPageHtml`, so the theme, the tones and the empty-container
rule reach all five of them from one place.

`LIFF_PAGE_CSP` is byte-for-byte unchanged — the logo is inline SVG, the type is the system stack,
so no new origin and no `img-src` edit were needed (`img-src 'self' data:` was already there).

## Verification

- `pnpm --filter @watchdog-bms/api test` — the fixed list, exit 0, **0 failing**. Counted from the
  dot reporter's own output: `pretest` 35 passing, `test` 7794 passing, **7829 total**. (An earlier
  revision of this file said 7810 before the tone work landed; an independent reviewer measured
  6465/6366 by a different method — if the two ever need reconciling, count with
  `scratchpad/count.py`, which splits the log at the pnpm script banners.)
- `pnpm typecheck` — all **seven** workspaces (design-tokens, config, contracts, workers, web,
  ai-gateway, api), exit 0.
- `node infra/security/sync-production-maintenance-release-pins.mjs --check` — `exactFiles=45 status=current`.
- Mutation checks, each applied then restored:
  1. remove `@IsNotEmpty` → `LineSignupSubmitBodyDto — the phone is required` fails.
  2. `requireThaiMobile(cmd.phoneNumber)` → `cmd.phoneNumber` → 3 subtests of
     `SubmitLineSignupUseCase — identity and clickwrap` fail.
  3. delete `el.hidden = !text.trim()` → all 3 empty-container tests fail.
  4. pin the tone class to `notice-info` → **12** tests fail across the phone, tone and
     init-failure suites.
- **Screenshots at 390×664 and 375×667** (the reviewer is right that this IS achievable): render the
  HTML to a file, serve the directory with `python3 -m http.server` on 127.0.0.1, and drive
  `http://127.0.0.1:<port>/…`. Confirmed there: the warning notice is yellow with the rule under the
  reddened phone input, the error notice is red with the support line, `#detail` computes to
  `display:none`, the challenge wraps to 2 lines ending at x=329 of 375, and
  `documentElement.scrollWidth === clientWidth === 375` (no horizontal overflow).
  **Never navigate the preview pane at a `file://` URL** — it rewrites the file it opens.

## Next

Nothing pending in code. A UAT deploy would be the next real check of the theme on a phone.
