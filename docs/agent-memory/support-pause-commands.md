# Agent Memory: support-pause-commands

Status: DONE (gates green, no PR, not deployed) — branch `codex/support-pause-commands` from
`origin/develop` (f2bd38ed, live on UAT)
Owner: Owner (UAT screenshots 2026-09-06 15:42 ICT)
Scope: the support pause must silence the ASSISTANT, not the product — and the words that lift it
must match the words the reply prints.

## Report

One chat, paused by a "ติดต่อเจ้าหน้าที่" tap at 10:58, four screenshots at 15:42 on build
`f2bd38ed`:

1. `/companies` → "📮 ส่งข้อความถึงทีมงานแล้วค่ะ ทีมงานจะตอบกลับในแชทนี้นะคะ · พิมพ์ …" instead of
   the company card.
2. rich-menu "คุยกับน้องมั่งมี" → the ordinary welcome "สวัสดีค่ะ 😊 น้องมั่งมีมาแล้วนะคะ…", flatly
   contradicting the hold the same chat had just been told about.
3. `คุยกับ ai ต่อ` — the phrase the reply advertises, in the case a phone keyboard produces →
   the same confirmation, and the pause stayed on.
4. `จ้า` → the same seven-line confirmation a third time.

## Root cause (four, all verified in code on develop f2bd38ed)

| # | Defect | Where |
|---|---|---|
| D1 | `RESUME_AI_COMMAND` / `RESUME_AI_ALT_COMMAND` were matched by exact normalized equality, so `ai`, `Ai` or a stray double space fell through to the pause gate and were filed as a follow-up | `line-staff-menu.logic.ts:514` (`staffMenuCommand`) |
| D2 | the pause gate sat ABOVE every remaining deterministic handler — `/companies` (`parseLineCompanyCommand`), `เมนูหลัก`/`ถามข้อมูล`/`รายการรออนุมัติ`, `ถ่ายใบเสร็จ`, `บริการของเรา`, the draft-edit answers — so all of them were swallowed, recorded as customer follow-ups and answered with a confirmation | `process-line-webhook.use-case.ts:2794` vs `:2811`, `:2867`, `:2916`, `:2967` |
| D3 | the `talk` postback returned the welcome unconditionally, above the gate | `process-line-webhook.use-case.ts:2716` |
| D4 | every free-text follow-up got the full `SUPPORT_FOLLOW_UP_REPLY`, menu hint and all | the gate's own reply |

The nine public commands ABOVE the gate (employee, staff_contact, resume_ai, contact, talk,
promotion, follow, package_change, profile_guard) were already exempt by position — that exemption
was never extended to the menu commands that need company and permission resolution first.

## Rules now (spec §2.2 delta รอบ 6)

- **The gate applies to FREE TEXT only.** `publicCommand !== null || parseLineCompanyCommand(text)`
  means the turn is a card this code builds itself: no model, no cost, and a button we put in front
  of the customer. It runs as usual, is NOT recorded as a follow-up, and gets no confirmation.
- **S-4's two phrases are only a command while its lane is lit.** With `draftUpdate.enabled` false
  they are ordinary text and stay under the pause — otherwise a rollback would silently open a paid
  AI turn to a paused chat. That is the one condition on the bypass.
- **`talk` under the pause answers `SUPPORT_PAUSED_REPLY`** and records nothing. It costs one
  indexed `findUnique` on a rich-menu tap.
- **`menuCommandKey`** folds the input once: tile emoji stripped, inner whitespace collapsed, Latin
  case folded. Still a WHOLE-string match, so §3 (a quoted command cannot resume the assistant on
  the customer's behalf) is untouched — the three injection strings in the spec stay non-matching.
- **The confirmation is rationed, the record is not.** Every follow-up still lands on the request;
  the full card is sent at most once per 10 minutes per request, off `lastMessageAt` read BEFORE the
  update. Within the window: "📮 รับข้อความแล้วค่ะ", no menu hint.

### Latin-letter audit of the command table (asked for explicitly)

Every string `staffMenuCommand` matches, checked one by one:

| Command | Latin? |
|---|---|
| `เมนูหลัก`, `ถามข้อมูล`, `รายการรออนุมัติ`, `ถ่ายใบเสร็จ`, `บริการของเรา`, `ติดต่อเรา`, `คุยกับน้องมั่งมี`, `โปรโมชั่น`, `แพ็กเกจ` | no |
| `PACKAGE_CHANGE_COMMAND` `ขอเปลี่ยนแพ็กเกจ`, `EMPLOYEE_DOOR_COMMAND` `ฉันเป็นพนักงาน`, `STAFF_CONTACT_COMMAND` `ติดต่อเจ้าหน้าที่` | no |
| `PROFILE_GUARD_COMMAND` `ใส่เลย`, `PROFILE_GUARD_LATER_COMMAND` `ไว้ก่อน` | no |
| `DRAFT_UPDATE_CONFIRM_COMMAND` `ยืนยันการแก้ไข`, `DRAFT_UPDATE_CANCEL_COMMAND` `ยกเลิกการแก้ไข` | no |
| `LINE_FOLLOW_EVENT_TEXT` `เพิ่มเพื่อนใหม่` | no |
| **`RESUME_AI_COMMAND` `คุยกับ AI ต่อ`** | **yes — "AI"** |
| **`RESUME_AI_ALT_COMMAND` `ให้ AI ตอบ`** | **yes — "AI"** |

Two of nineteen, and they are also the only two containing a space at all — so collapsing inner
whitespace and folding case changes nothing for the other seventeen. `parseLineCompanyCommand`
(`/companies`, `/company`) already lowercased its own input before this change.

The fold does create one footgun: the matcher folds its INPUT and compares against raw literals, so
a future constant written with uppercase Latin or a double space would silently stop matching
itself — exactly the resume bug, one level down. Pinned by a new case in
`line-staff-menu.logic.spec.ts` that feeds all nineteen commands back through `staffMenuCommand`.

## Decisions

- **Guard the gate, do not move it.** Moving the pause gate below the menu handlers would put
  `resolveCompanyForLineUser`, `resolveAccess`, `loadEntitledFeatureKeys` and
  `refusePendingLegalAcceptance` in front of every paused free-text message — a paused customer with
  no membership would hear "link your account" instead of "we are looking into it". A two-line
  predicate at the existing site is both smaller and narrower.
- **A bare digit bypasses the pause ONLY while a picker is pending** (review 2026-09-06 M1, reversing
  the first cut's "never"): the picker `/companies` returns under the pause says "ตอบ N หรือกดปุ่ม
  ด้านล่าง", and the Owner is a multi-company account. The gate reuses `pendingCompanySelectionCommand`
  as-is — digits-only (Thai digits included, via `parseBareCompanySelection`) is the precondition of
  its one indexed read, so free text never pays it; with no picker pending, "2" stays a follow-up.
- **`recordSupportFollowUp` returns `'none' | 'recorded' | 'repeat'`** instead of a boolean. The
  throttle is the caller's decision (which words to say), and the reply map keeps the call site one
  line. `handleStaffContact` ignores the value, as it did the boolean — a tap answers
  `SUPPORT_ALREADY_OPEN_REPLY`, which is a different message and is not rationed.
- **The clock is `lastMessageAt`, read before the write.** No column, no cache, no timer, and it is
  the same stamp the inbox clock and the expiry sweep already run on. A tap therefore also starts
  the 10 minutes, which is right: the tap's own reply carries the same hint.
- **Resume was already correct** and is now pinned: `handleAssistantResume` clears
  `aiPausedUntil` for the LINE user and closes their `OPEN` request `customer_resumed`. An
  `ANSWERED` row is deliberately left alone — it is not on the รอตอบ tab, so it is not the reported
  defect, and the sweep closes it on age.

## Artifacts

- `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts` — new `menuCommandKey()`;
  `staffMenuCommand` folds through it and compares the two resume commands through it too.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` —
  `SUPPORT_FOLLOW_UP_REPEAT_REPLY`, `SUPPORT_FOLLOW_UP_REPLY_INTERVAL_MS`,
  `SUPPORT_FOLLOW_UP_REPLIES` and `SupportFollowUpOutcome`; the `talk` branch's pause check; the
  `deterministicCommand` guard on the pause gate; `findLiveSupportRequest` selects `lastMessageAt`;
  `recordSupportFollowUp` returns the outcome.
- Specs: `line-staff-menu.logic.spec.ts` (case/whitespace cases + the whole-table round trip),
  `line-first-signup-webhook.spec.ts` (new รอบ 6 describe: `/companies`, the tile, lowercase resume,
  the throttle), `process-line-webhook.use-case.spec.ts` (`เมนูหลัก` under a pause, on the fuller
  harness that resolves permissions), `line-support-request.pg.spec.ts` (lowercase resume end to
  end; the throttle with real timestamps, backdated rather than waited for).
- No schema change, no migration, no contract change, no web change, no `package.json` change.

## Verification (2026-09-06, on the committed tree)

| Gate | Result |
|---|---|
| `line-staff-menu.logic.spec.ts` | 39 pass / 0 fail — **1 red first** (38/1): the four case/whitespace spellings |
| `line-first-signup-webhook.spec.ts` | 60 pass / 0 fail — **4 red first** (56/4): `/companies`, the rich-menu tile, lowercase resume, the throttle |
| `process-line-webhook.use-case.spec.ts` | 206 pass / 0 fail — **1 red first** (205/1): `เมนูหลัก` under a pause |
| all three together, after the fix | 305 pass / 0 fail |
| `line-support-request.pg.spec.ts` (isolated `postgres:18.3-alpine`, 127.0.0.1:15497, `migrate deploy` + `sync-permissions`, container removed) | 16 pass / 0 fail — **1 red first** (15/1): the reopen case's reply, which the throttle changed on real rows |
| D1 mutation on the pg lane: `menuCommandKey(RESUME_AI_COMMAND)` → `RESUME_AI_COMMAND` | 14 pass / **2 fail** ("brings the assistant back", "never reopens a CLOSED request"), green again on restore |
| `line-intake-dispatch.use-case.spec.ts` + `spec-suite-coverage.spec.ts` | 183 pass / 0 fail (no new spec file, so no `package.json` edit) |
| `pnpm --filter @watchdog-bms/api typecheck` | clean |
| `node apps/api/scripts/check-di-metadata.mjs` | 795 files, 870 decorated classes, 820 with deps — all carry `design:paramtypes` |
| `pnpm --filter @watchdog-bms/api test:boot` | Nest resolved every provider in 131 ms |
| `pnpm --filter @watchdog-bms/api test` (full fixed list, under the `mkdir /tmp/mangmee-heavy.lock` mutex) | exit 0, zero `✖`, 9661 dot-reporter marks |

Not run: `infra/docker/production-image-security.spec.sh` (out of scope, and explicitly excluded),
web suites (nothing web-facing changed), and no UAT deploy.

### Adversarial review 2026-09-06 (second pair of eyes, branch head aa550cc9, fresh worktree)

Re-run: typecheck clean; `line-staff-menu.logic` 39/0, `line-first-signup-webhook` 60/0,
`process-line-webhook.use-case` 206/0, `line-intake-dispatch` 180/0, `spec-suite-coverage` 3/0,
neighbours `line-message-buffer.service` 66/0 and `line-webhook.controller` 9/0, pg spec 16/0
(isolated `postgres:18.3-alpine` on 127.0.0.1:15497, removed after), DI guard 795/870/820.

| Mutation (one at a time, file restored after each) | Result |
|---|---|
| fold: drop `.toLowerCase()` in `menuCommandKey` | logic spec 38/1 |
| gate: back to bare `assistantPaused` | signup 59/1 (`/companies`), use-case 205/1 (`เมนูหลัก`), pg 16/0 |
| throttle: always `'recorded'` | signup 59/1 (burst), pg 15/1 (reopen) |
| talk: pause check removed | signup 59/1 (tile) |
| clock: as if read AFTER the write (`Date.now()`) | signup 58/2, pg 15/1 |
| S-4 flag ignored in the bypass (`publicCommand !== null`) | **survived** (60/0, 206/0) → now pinned by "keeps the draft-edit phrases under the pause while the S-4 lane is dark" (59/1 under the mutation, green on the branch) |

### M1 follow-up 2026-09-06 (the typed picker number under the pause)

`line-first-signup-webhook.spec.ts` 64 pass / 0 fail — **1 red first** (63/1: "honours the number the
picker asked for, under the pause", `contextUpserts[0]` undefined); the two guards ("keeps a bare
number as a follow-up when nothing asked for one", `"2 คน"` with a picker pending) were green before
and after. Mutation — clause removed, gate back to bare `assistantPaused` — 63/1 on the same case,
64/0 restored. `process-line-webhook.use-case` 206/0, `line-staff-menu.logic` 39/0,
`spec-suite-coverage` 3/0, typecheck clean, DI guard 795/870/820. Harness gained a
`lineWebhookEventLog.findFirst` fake that reads the previous turn's recorded outcome back, so the
`/companies` → `2` sequence is real, not a preset status.

Command-table probe: 19 commands → 19 distinct keys, no collisions. The three spec injection strings,
`คุยกับ AI ต่อ /companies`, `คุยกับ AI ต่อ\nขอเปลี่ยนแพ็กเกจ`, a ZWSP-joined spelling, fullwidth `ＡＩ` and
dotless-i all stay `null`; NFD/NFKC forms of every command still match (no canonical compositions in
this table). Inherited, not new: the four tile emoji are stripped anywhere, so `📊คุยกับ AI ต่อ✅` resumes.

## Open questions / follow-ups (not in this change)

- A receipt PHOTO under a pause is still OCR'd and answered by the assistant — the media lane has no
  pause gate (carried over from `support-request-continuity`). Since round 3 the photo leaves a
  `lastMediaAt` marker and nothing else, so it neither reopens the request nor extends the mute, but
  the assistant does still speak into a thread a human is holding. That is the last place the pause
  is not honoured.
- An UNLINKED prospect's follow-up text still hits the entry-door card above the pause gate (F8 in
  `support-request-continuity`), so it is never appended. Unchanged.
- The 10-minute window is a constant, not config. If the Owner wants a different cadence it is one
  number in `process-line-webhook.use-case.ts`.
- `handleAssistantResume` closes `OPEN` only. If the Owner decides a customer resume should also
  settle an `ANSWERED` thread, that is a one-word change to the `status` filter plus a test.

## Next

- Owner acceptance on UAT, in one paused chat: tap "ติดต่อเจ้าหน้าที่", then (a) `/companies` must
  answer the company card with no confirmation, (b) the rich-menu "คุยกับน้องมั่งมี" tile must answer
  "ทีมงานรับเรื่องแล้วค่ะ กำลังดูให้อยู่ …" and not the welcome, (c) two messages a minute apart must
  give the full card once then "📮 รับข้อความแล้วค่ะ" — with BOTH lines visible in
  `/system/support-requests`, (d) `คุยกับ ai ต่อ` in lowercase must answer "น้องมั่งมีกลับมาแล้วค่ะ"
  and drop the row off the รอตอบ tab, (e) `/companies` then a typed `2` must switch the shop with no
  📮 line and nothing new in `/system/support-requests`.
