# Agent Memory: liff-signup-ux-batch

Status: implemented on `codex/liff-signup-ux-batch`, rebased onto develop f44b0519 (PR #428);
API suite and typecheck green; no PR opened (by instruction).

Owner: Owner UAT feedback 2026-09-05, from the LIFF signup form opened in LINE on iPhone.

Scope: the fifteen UX decisions below, across the five API-served LIFF pages only. No web app, no
infrastructure, no pinned files. The only `package.json` edit is appending one spec path (see the
meta-test note under Verification).

## Decisions (Owner 2026-09-05)

1. **Phone is required** — supersedes the 2026-09-04 "ไม่บังคับ" decision and the Baymard evidence
   behind it (§14, now annotated as overridden). Label is bare "เบอร์มือถือ"; input carries
   `required` and `inputmode="tel"`.
2. ~~**The 64-hex `displayChallenge` may not overflow** — it is legal evidence, so it wraps rather
   than truncating: its own block, monospace 12px, `overflow-wrap:anywhere; word-break:break-all`.~~
   **SUPERSEDED 2026-09-06** (`codex/liff-signup-hide-legal-challenge`): the Owner asked for the
   hash to go away entirely — *"เอา hash ที่แสดงบน line lif ออกหน่อย ... ที่อยู่ข้างล่าง privacy"*. The
   label and the `<p class="challenge">` block and the `.challenge` rule are removed; the value
   stays in `data-legal-challenge`, the script still posts it and the server still validates and
   stores it, so the LEGAL-LIFF-01 evidence contract is unchanged. Nothing wraps because nothing
   is rendered.
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
| 2 | `auth.controller.ts` — `.challenge` rule + its own `<p class="challenge">` block (**both deleted again 2026-09-06**, see the superseding note above) |
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
9. **Guidance map** keyed on the codes the server *actually* answers with; unknown codes fall to the
   generic error copy and the raw code is never shown to a customer.
   `line_signup_identity_disabled` and `line_signup_account_blocked` were named in the round-4 brief
   but did not exist on this path **at that time**, so they were deliberately left out rather than
   invented. They arrived for real with PR #428 and are mapped now — see round 6.
10. **Contrast (review SHOULD-FIX 2).** White on `--brand` #22C55E is 2.28:1 and failed AA on the
    submit button, every `a.btn` and the header bar. All three now use `--brand-dark` #15803D
    (5.02:1); #22C55E survives only as the success notice's left rule, where no text sits on it.
    `liff-page-contrast.spec.ts` *computes* the ratios rather than pinning hexes.
11. **Fifth LIFF page (review SHOULD-FIX 3).** `crm-inbox`'s `customer-register-page` built its own
    HTML with the pre-theme stylesheet and no `:empty` rule. Migrated onto `liffPageHtml`; its
    existing security spec (2 external scripts, CSP, escaping, `#liff-content`) passes unchanged,
    and every id and every string of customer-facing copy is identical. Its PDPA notice opts out of
    the shared `pre` rule via `.consent-notice` so long-form legal text stays at reading size.

## Round 5 — review LOW items (2026-09-05)

12. **LOW-2** `line_signup_evidence_missing` (409 from `provision-signup.use-case.ts:332`) reaches
    this page because AUTO_FREE provisions inline inside the submit. Error tone; the advice says
    *not* to re-send, because the row is corrupt rather than incomplete — only support can fix it.
13. **LOW-3** A 400 carrying no code we know is the global ValidationPipe, whose `message` is an
    array of English constraint strings. It now maps to a warning with a reload action instead of
    GENERIC_ERROR: an out-of-step page is reloadable, not a system fault.
14. **LOW-4** The network branch in `runWith` now passes `errorDetail(error)` through to `#detail`.
    That branch also catches a 202 whose JSON will not parse, `currentIdToken()` throwing, and a
    failed status re-read inside the 409 branch — cases where the raw message is the only
    diagnostic support will ever get.
15. **LOW-5** Dropped the `<p>` around `#notice-action` (a hidden button inside a visible paragraph
    still left that paragraph's 16px margins as a gap under the notice) and moved
    `.consent-notice` from `40vh` to `40dvh` per the project's mobile rule.

**LOW-6 is deliberately NOT done.** The CRM customer-register page is the one LIFF page whose
audience is the *shop's* customers, not ours, and it now shows a "มั่งมีพลัส" bar above the shop's
own name. Whether that co-branding is wanted is the Owner's call, not a reviewer's or mine — left
as-is pending that decision.

**Gotcha for the next editor:** `LIFF_PAGE_SCRIPT` and `LIFF_PAGE_STYLE` are both template
literals. A backtick in a comment inside either one terminates the template and the file stops
compiling — write those comments without backticks. This cost three build failures across this
batch; the compiler catches it immediately, so no test guards it.

Every LIFF page is now built by `liffPageHtml`, so the theme, the tones and the empty-container
rule reach all five of them from one place.

`LIFF_PAGE_CSP` is byte-for-byte unchanged — the logo is inline SVG, the type is the system stack,
so no new origin and no `img-src` edit were needed (`img-src 'self' data:` was already there).

## Verification

- `pnpm --filter @watchdog-bms/api test` — the packaged script, **exit 0**.

  Counts come from the **spec reporter's own summary**, not from counting dot-reporter characters:
  the packaged scripts use `--test-reporter=dot`, which prints one character per test, emits no
  summary, and — the reason the earlier numbers in this file were wrong — prints nothing at all for
  a *skipped* test, so a character count silently overstates "passing" and hides the skips.
  Re-run the same two file lists with `--test-reporter=spec` (see
  `scratchpad/run-suite-spec.sh`) and quote these lines:

  | list | tests | pass | fail | skipped |
  |---|---|---|---|---|
  | `pretest` | 30 | 16 | 0 | 14 |
  | `test` | 6513 | 6414 | 0 | 99 |

  (Pre-rebase this branch alone read 6480/6381; the rebase onto develop f44b0519 brought
  PR #428's tests in, hence +33.)

  Earlier revisions of this file claimed 7810 and then 7829 "passing" from the dot-character
  method; both were wrong. The round-3 reviewer measured 6477/6378/0/99, and this run is +3 tests
  on the `test` list — exactly the three added for LOW-2, LOW-3 and LOW-4.
- The repo has a meta-test, `every spec file is wired into a package.json script`, which is why
  `liff-page-contrast.spec.ts` had to be appended to `apps/api` `scripts.test`. It passes.
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

## Round 6 — rebase onto develop f44b0519 (`codex/line-signup-stale-identity`, PR #428)

Two conflicts, both in `liff-page.security.ts`; `apps/api/package.json` did **not** conflict — the
sibling changed no package.json, so the `liff-page-contrast.spec.ts` path applied cleanly.

1. **`submitSignup`'s refusal block.** The sibling had added two bare-`Error` branches for its new
   409s. Resolution keeps this branch's `signupGuidance()` structure and moves those two codes into
   `SIGNUP_GUIDANCE` as error-tone entries carrying `SIGNUP_BLOCKED_TH` verbatim — so the support
   sentence lands in the red notice a customer reads instead of the grey monospace `#detail` box.
   The sibling's own two tests moved their assertions from `#detail` to `#status` for the same
   reason; copy and intent unchanged.
2. **The guidance map itself**, where round 5's `line_signup_evidence_missing` and the two new
   entries landed on the same line. Both sides kept.

`SIGNUP_BLOCKED_TH` is used whole as the entry's `text` with **no** `advice`: the sentence is
already "what went wrong AND who to call", so splitting it would have repeated a clause.

**The first version of the mutation check passed, and that was the finding.** Dropping
`line_signup_account_blocked` still satisfied the sibling's assertions, because they only looked
for the phone and the email — and `GENERIC_ERROR`'s advice contains both, so the generic fallback
was indistinguishable from the real mapping. The tests now pin this refusal's own opening clause
and assert it is *not* the generic copy; dropping either entry then fails exactly its own test.

Everything else from the sibling is untouched: the only diff left in `submit-line-signup.use-case.ts`
against develop is this branch's required-phone work, and its `repeatTrial` audit field survives.
- **Screenshots at 390×664 and 375×667** (the reviewer is right that this IS achievable): render the
  HTML to a file, serve the directory with `python3 -m http.server` on 127.0.0.1, and drive
  `http://127.0.0.1:<port>/…`. Confirmed there: the warning notice is yellow with the rule under the
  reddened phone input, the error notice is red with the support line, `#detail` computes to
  `display:none`, the challenge wraps to 2 lines ending at x=329 of 375, and
  `documentElement.scrollWidth === clientWidth === 375` (no horizontal overflow).
  **Never navigate the preview pane at a `file://` URL** — it rewrites the file it opens.

## Next

Nothing pending in code. A UAT deploy would be the next real check of the theme on a phone.
