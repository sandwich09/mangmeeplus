# Agent Memory: LINE pending-shop hint on บริษัทของฉัน

Status: Implemented and pushed on `codex/line-pending-shop-hint` (cut from `origin/develop` at `f2bd38ed`).
No PR opened (Owner instruction). Not deployed.
Owner: MangmeeDev
Scope: One UX defect from the UAT round of 2026-09-06 — the บริษัทของฉัน card and the LIFF signup
"done" card, both of which went silent about a shop request that was queued for manual review.

## UAT evidence (2026-09-06 15:46 ICT, build f2bd38ed)

Owner report: **"สมัครแล้วแต่บริษัทหาย"**.

From the UAT database, the Owner (LINE already linked, `OWNER` of "test sand"):

- tapped the new **"เปิดร้านใหม่"** button on the บริษัทของฉัน card;
- submitted the LIFF form with shop name **"ร้านใหม่"** at 08:45:00Z;
- `CompanySignupRequest` `cmtpkg7jg000p1k4gvonunp2b`, `source = line-oa`, state **`PENDING_REVIEW`**;
- audit `signup.line.submitted {repeatTrial:true, existingAccount:true}` then
  `signup.line.auto_approve_repeat_trial {reason: repeat_trial_manual_review}`.

That queueing is **by design**: a repeat trial for the same LINE account always falls back to the
admin queue, AUTO_FREE or not (spec §3.3, and `submit-line-signup.use-case.ts` `decideAndRun`; see
`docs/agent-memory/line-second-shop-button-auto-free-uat.md`). The defect is not the queue — it is
that neither surface the Owner then looked at mentioned the request. `/companies` re-rendered the
same picker and the same "เปิดร้านใหม่" button, so the shop read as having vanished, and the button
invited a second application that the partial unique index could only refuse with
`line_signup_already_pending`.

## Rule implemented

1. **บริษัทของฉัน card** (`buildCompanyContextMessage`) takes one new optional
   `pendingSignupName`. When the LINE account has an application in an open state it renders one
   status line and **withholds** the "เปิดร้านใหม่" footer button:

   `🕒 คำขอเปิดร้าน «<ชื่อร้าน>» รอทีมงานตรวจสอบ ปกติภายในวันทำการ`

   - The name is scrubbed with `scrubRecordText(value, 60)` from `@watchdog-bms/contracts` — the
     same helper `line-draft-update-card.logic.ts` uses — because a shop name is customer-supplied
     free text that reaches an owner's card unreviewed. A name that scrubs away to nothing (e.g. a
     bare link) degrades to `🕒 คำขอเปิดร้านใหม่ รอทีมงานตรวจสอบ ปกติภายในวันทำการ` rather than
     rendering empty `«»`.
   - The line is appended to `altText` too, since the chat list is where "it vanished" was decided.
   - No `+` character in any customer-facing string (spec §3).
   - Nothing changes for an owner with no open request: the card is byte-identical to today, with
     or without the signup door (asserted).

2. **LIFF signup "done" card**, `existingAccount === true` branch: one sentence added so the outcome
   is explicit on the form itself —
   `เพิ่มร้านที่ 2 ให้บัญชีของคุณแล้วค่ะ ร้านใหม่จะขึ้นในเมนู บริษัทของฉัน หลังทีมงานอนุมัตินะคะ พร้อมเมื่อไหร่เราจะส่งข้อความในแชทนี้นะคะ`

## Decisions

- **One wording for every open state, including provisioning/failed.** The brief asked for the
  wording `buildSignupStatusCard` "already uses for that state". Reading it (and `showPending` on the
  LIFF page, and `GetLineSignupStatusUseCase`) shows there is **no per-state wording anywhere**: the
  status card varies only on business hours and says "ทีมงานกำลังตรวจสอบ" for all six of
  `RECEIVED / VALIDATED / PENDING_REVIEW / PROVISIONING / PROVISIONING_FAILED / READY`. So this card
  says the same thing for all of them, and no `state` value is threaded into the card contract — a
  parameter no branch reads would be dead data, and per-state copy invented here would make the chat
  card and the LIFF page disagree, which is the class of bug this change fixes. `PROVISIONING_FAILED`
  is covered as a real state in the use-case spec, where a state actually exists.
- **Reused `findOpenLineSignup`, not `pendingSignupFor`.** The brief named `pendingSignupFor`, but
  `findOpenLineSignup` is the same `OPEN_LINE_SIGNUP_STATES` read, already selects `companyName`, and
  is **channel-scoped** (`lineChannelId`) — `pendingSignupFor` selects only `id` and is not. Reusing
  it is both the smaller diff (zero new queries) and the stricter filter, and it keeps the door card
  and the company card answering from one read, which is exactly the invariant its own comment
  demands.
- **The lookup is unconditional**, not gated on `newShopSignupUrl()` being set. If
  `EXTERNAL_SIGNUP_ENABLED` were flipped off while a request was open, gating would hide the hint and
  reproduce the original defect. One indexed `findFirst` on a `/companies` command is not worth the
  coupling.
- Colour reuses `#475467`, the muted body colour the card already uses; no new palette entry.

## Open questions

- None blocking. Worth an Owner decision later: whether `PROVISIONING` / `READY` (the shop is being
  built, not reviewed) eventually deserve their own sentence — if so, it has to change
  `buildSignupStatusCard`, the LIFF `showPending` copy and this line together, never one of them.

## Artifacts

- `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts` (+ `.spec.ts`)
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` (+ `.spec.ts`)
- `apps/api/src/common/security/liff-page.security.ts`
- `apps/api/src/modules/auth/line-liff-signup.spec.ts`

## Verification

Red first, on the branch before the implementation hunks:

- `line-staff-menu.logic.spec.ts` — 41 tests, 38 pass, **3 fail**
- `process-line-webhook.use-case.spec.ts` — 207 tests, 206 pass, **1 fail**
  (the "settled application keeps the door" case passed already, as it must)
- `line-liff-signup.spec.ts` — 45 tests, 44 pass, **1 fail**

Green after:

- `line-staff-menu.logic.spec.ts` — 41/41
- `process-line-webhook.use-case.spec.ts` — 207/207
- `line-liff-signup.spec.ts` — 45/45
- `liff-page-contrast.spec.ts` + `spec-suite-coverage.spec.ts` + `line-first-signup-webhook.spec.ts`
  — 63/63
- `node apps/api/scripts/check-di-metadata.mjs` — 795 files, 870 decorated classes, 820 with
  constructor dependencies, all carry `design:paramtypes`
- `pnpm --filter @watchdog-bms/api run typecheck` — clean
- `pnpm --filter @watchdog-bms/api run test:boot` — `boot-di-smoke: Nest resolved every provider in 135ms`
- Full api fixed list under `/tmp/mangmee-heavy.lock` (mkdir/rmdir, acquired and released) —
  exit 0, **8,269 passing**, zero non-pass characters in the dot stream
- `git diff --check` clean; no `package.json` touched

`infra/docker/production-image-security.spec.sh` deliberately not run (out of scope for this change).

## Review 2026-09-06 (adversarial pass on 6c857e94)

Verdict: READY, with one root-cause fix committed on this branch.

- **Fixed — half an emoji at the 60-unit bound.** `LINE_SIGNUP_COMPANY_NAME_MAX` is 120 UTF-16
  units and `scrubRecordText(name, 60)` ended in `.slice(0, 60)`, so a name with an astral character
  straddling units 59/60 (`'ก'.repeat(59) + '😀' + 'ข'`) put a lone `\ud83d` into the card's text
  node and altText — not a character LINE can receive. Fixed once in the helper
  (`packages/contracts/src/line-ai.ts`): the bound drops a trailing lone high surrogate, so every
  caller (api draft cards, ai-gateway formatters) inherits it and a 60-unit emoji still fits whole.
  Red then green on `line-ai-record-text.spec.ts`: 24 tests, 23 pass / 1 fail → 24/24.
- **Open, wording only (Owner call) — an open state can coexist with a live membership.** The
  onboarding transaction creates the company and its ACTIVE OWNER membership while the row is still
  `PROVISIONING`; `READY` is stamped after the trial guards and VAT write, `COMPLETED` after the
  audit transaction (`provision-signup.use-case.ts`, `company-signup-core.service.ts`). In that
  window — sub-second normally, lasting when provisioning fails after the company commit
  (`PROVISIONING_FAILED` with `companyId` set, the HIGH-A recovery case) — `/companies` lists the
  new shop in the picker AND prints `🕒 คำขอเปิดร้าน «X» รอทีมงานตรวจสอบ` for the same X. The door
  must stay withheld there (the partial unique index refuses a second application), so only the
  sentence is off, and it is the sentence the door card and the LIFF page share.
- Scope proof: `findOpenLineSignup` keys on `(source line-oa, lineProviderUserId = webhook userId,
  lineChannelId = LINE_MESSAGING_CHANNEL_ID, state ∈ OPEN)` and answers null with no channel id;
  the LIFF submit stores `LineIdTokenService.verify().channelId` (`lineMessagingChannelId ??
  lineLoginChannelId`) and the token `sub` — the same pair on both sides.
- Not a regression, worth knowing: `newShopSignupUrl()` is not role-gated on develop either — a
  STAFF member who types `/companies` gets the door wherever signup is open (the menu only hides
  the item). Whether an employee may open a shop of their own is a product call, unchanged here.
- Cost: one extra indexed `companySignupRequest.findFirst` per `/companies` list render (2 → 3
  reads); not on switch, menus, or message turns; nothing already loaded in a linked turn to reuse.
- Mutations: dropping `pendingSignupName:` at the call site → use-case spec 207 tests, 206 pass,
  1 fail; replacing the scrub with the raw name → logic spec 41 tests, 39 pass, 2 fail.
- Gates re-run with the fix: api typecheck clean; contracts typecheck clean; contracts `test`
  246/246; `line-staff-menu.logic.spec.ts` 41/41; `process-line-webhook.use-case.spec.ts` 207/207;
  `line-draft-update-card.logic.spec.ts` + `line-draft-update.logic.spec.ts` 41/41; ai-gateway
  `draft-update-formatter.spec.ts` + `expense-explain-record.spec.ts` 45/45; DI guard 795/870/820.

## Next

- Owner reviews the copy; it rides the next UAT deploy with no flag and no config of its own.
- Re-run the UAT journey that produced the report: apply for a second shop, then send `/companies`
  and confirm the card shows the 🕒 line and no "เปิดร้านใหม่" button until the queue clears.
