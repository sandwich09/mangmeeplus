# Agent Memory: support-request-continuity

Status: DONE (round-3 review fixes applied, gates green, not deployed) — branch
`codex/support-request-continuity` from `origin/develop` (178d3fb6); PR #446
Owner: Owner (UAT report 2026-09-06)
Scope: `LineSupportRequest` continuity — a customer who writes back after "ตอบแล้ว" must reach the inbox again.

## Report

UAT 2026-09-06: "คุยกับเจ้าหน้าที่ — เจ้าหน้าที่ตอบกลับแล้วคำขอหายไปเลย ทั้งที่ยังไม่จบ".

## Root cause (verified in code, develop 178d3fb6)

1. `process-line-webhook.use-case.ts` writes `lastMessageText` exactly once — at the tap, from the
   last `AiTurn` preview (`resolveSupportAsker`). Nothing else ever writes it.
2. The pause gate (`execute`, the `assistantPaused` branch) answers every later customer message
   with `SUPPORT_PAUSED_REPLY` and returns. It never looks at `LineSupportRequest`, so the message
   is not appended, the request is not reopened, and no audit row records that anyone wrote.
3. `markAnswered` / `send-partner-line-message` move the row to `ANSWERED`, which drops it out of
   the รอตอบ tab and out of `openCount` (the header badge). Nothing can put it back: the only
   OPEN-restoring writes in the codebase are… none.
4. The media lane (`executeReceiptUploadInner`) has no pause gate at all, so a photo sent to a
   waiting human is processed as a receipt and the request learns nothing either.

Net effect: after the first admin answer the thread is a black hole — the customer keeps typing,
the canned reply says "กำลังดูให้อยู่", and no operator surface changes.

## State machine after the change

```
OPEN ──(admin "ตอบแล้ว" | partner message delivered)──▶ ANSWERED
  ▲                                                        │
  └──(customer TEXT under the pause OR a second tap, reopenedCount += 1)──┘
OPEN/ANSWERED ──(customer resume | admin resume | sweep 24h after lastMessageAt)──▶ CLOSED
OPEN/ANSWERED ──(customer photo/file)──▶ same status, lastMediaAt stamped, nothing else moves
```

- `answeredAt` / `answeredByUserId` are kept as the history of the last answer.
- `reopenedCount` counts answer→customer-reply round trips; the inbox chip reads it (≥ 1 only).
- `lastMessageAt` is the newest customer message. The waiting clock counts from it, the expiry
  sweep counts from it, and the assistant's pause is re-armed to it + 24 h — one stamp, three uses.
- `requestText` is the question and never moves; `lastMessageText` is the newest TEXT; a photo
  stamps `lastMediaAt` and touches neither.
- **Only two things count as the customer asking again** (round 3, N1): a TEXT follow-up under the
  pause, and a tap on "ติดต่อเจ้าหน้าที่". A photo or a file stamps `lastMediaAt` and stops there.
- CLOSED is terminal: a fresh "ติดต่อเจ้าหน้าที่" opens a new row (existing §2.2.4 behaviour).

## Decisions

- Three call sites, not a global choke point: the pause gate (text), the top of the media lane, and
  the tap's already-live branch. A lookup on every text event would put an extra query on the hot
  path for a case that cannot happen (no request → nothing to append).
- Schema delta is four additive columns and one index on `LineSupportRequest`; no new table.
  `@@index([lineUserId, status])` already serves the follow-up lookup; `[status, lastMessageAt]`
  was added in round 2 for the inbox read and the sweep, which both moved off `requestedAt`.
- The follow-up write is `updateMany` with the read status as its `where`, not `update`: the
  conditional IS the concurrency control, and no transaction is needed for a single row.
- `updatedAt` was rejected as the "latest customer message" stamp: the drain (`notifiedAt`) and the
  admin buttons write it too, so it cannot say a customer wrote.

## Adversarial review of 9281957f → NOT READY → fixed (2026-09-06, round 2)

Nine findings. All fixed red-first; the decisions are now spec §2.2 delta รอบ 4.

| # | Defect | Rule now |
|---|---|---|
| F1 (HIGH) | the sweep expired a request 24 h after `requestedAt`, so a thread reopened at hour 23 was closed at hour 24 — right after "ทีมงานจะตอบกลับในแชทนี้นะคะ" | **The thread's life is measured from the LAST customer message.** `sweepExpiredSupportRequests` filters on `lastMessageAt`, and a recorded follow-up re-arms `LineCompanyContext.aiPausedUntil` to that message + 24 h. Two clocks, one stamp. **Narrowed twice in round 3**: "follow-up" is a TEXT message or a tap, never a photo (N1), and the re-arm extends an existing pause without ever creating one (N2). An unlinked asker has no assistant to silence (§2.1.2), and their sweep window is `lastMessageAt` alone. |
| F2 (MED) | `findFirst` → `update` is read-then-write: "ตอบแล้ว" landing in the gap left the row ANSWERED while the customer was told the message was delivered | conditional `updateMany({ where: { id, status: <the status just read> } })`; `count === 0` means NOT recorded, and the caller sends the old, promise-free reply |
| F3 (MED) | `lastMessageText` was replaced, so a nudge or an unrelated receipt photo destroyed the question | new immutable `requestText` (backfilled from `lastMessageText`); `lastMessageText` = newest customer TEXT only; media stamps the new `lastMediaAt` and touches no words; the inbox shows the question, "ล่าสุด: …" when it has moved on, and "📷 ส่งรูปมา" beside them |
| F4 (MED) | the partner box pushed to owner ∪ EVERY open requester — two strangers read each other's answer | union reverted. Recipients = OWNER LINE ids **+ the one requester named by an optional `supportRequestId`** on `POST /system/partners/:companyId/line-message` (must be this shop's, not CLOSED, else 404). The inbox link carries `?support=<id>&asker=<askerRef>`; the box shows "ตอบถึง: ผู้ขอ <askerRef>" and marks that request ANSWERED with the button's own audit (`system.support_request.answered`, `via: partner_line_message`) |
| F5 (MED) | a reopened-then-closed row rendered "ใช้เวลา —" (end older than start) | the wait ends at the settling stamp that is **not older than the start**, `answeredAt` still winning over `closedAt` within one round trip; nothing older than the start ends anything, so the row falls back to "รอมานาน" instead of a negative duration |
| F6 (LOW) | the 200-char cap was unpinned | a 400-char follow-up stores exactly 200; removing the `.slice` turns that test red (shown) |
| F7 (LOW) | tapping "ติดต่อเจ้าหน้าที่" on an ANSWERED request opened a SECOND row, while typing reopened the first | one path: the dedupe reads `OPEN`/`ANSWERED` and the tap records a follow-up like any other message — with no text, because "ติดต่อเจ้าหน้าที่" is not a sentence an operator needs. A reopen is not a new request: no daily slot, no second page-out |
| F8 (LOW) | asymmetry, recorded not changed — see below | — |
| F9 (LOW) | the inbox read and the sweep both moved to `lastMessageAt` with no index behind them | `@@index([status, lastMessageAt])`, in the same unreleased migration |
| chip | floored at 1, so "ตอบแล้ว 1 ครั้ง" appeared on rows nobody had written back to | shown only when `reopenedCount >= 1`, and it prints the real count |

### F8 — the unlinked-asker asymmetry (recorded, deliberately unchanged)

A **photo** is recorded at the very top of `executeReceiptUploadInner`, before identity resolution,
so it lands on the request of an asker with no ACTIVE LINE identity as well. **Text** is recorded
only inside the pause gate, which sits *after* identity resolution — an unlinked prospect's follow-up
text hits the entry-door card above it and is never appended.

Not a regression and not the reported defect: an unlinked asker has no assistant to pause, so the
pause gate they would need is exactly the thing they do not have. Changing it means either a lookup
on every unlinked text event (a query on the hot path for the rarest case) or moving the door card,
which is a different feature. Left as is, written down so the next reader is not surprised that a
picture from a stranger reaches the inbox and their sentence does not.

## Adversarial review of 24d92630 → round 3 (2026-09-06)

All nine round-2 fixes confirmed. Three new findings, all fixed red-first; spec §2.2 delta รอบ 5.

| # | Defect | Rule now |
|---|---|---|
| N1 (MED) | `recordSupportFollowUp` sat at the top of the media lane, and re-armed the pause inside itself — so an ordinary receipt photo on a live or ANSWERED thread reopened the request, moved the waiting clock and muted the customer's own assistant for another day. A shop that uploads one receipt a day kept the mute AND the inbox row alive for ever. | **A photo/file is a MARKER.** New `stampSupportMedia(lineUserId)`: stamp `lastMediaAt` on the live request (OPEN or ANSWERED, same tenant rules) and stop. No reopen, no `lastMessageAt`, no pause re-arm, no `signup.line.support_follow_up` audit. The inbox still shows "📷 ส่งรูปมา" in whichever tab the row is in. Only a TEXT follow-up under the pause and a tap on "ติดต่อเจ้าหน้าที่" reopen, stamp `lastMessageAt` and re-arm. `recordSupportFollowUp`'s `message` shrank to `{ text?: string }`. |
| N2 (LOW) | the re-arm was an `upsert` whose CREATE branch used the request's stored `companyId` with no identity/membership re-check — and §2.5 DELETES `LineCompanyContext` on unlink, so an ex-member's follow-up rebuilt the row pointing at the shop they had left | the re-arm is `updateMany({ where: { lineUserId, aiPausedUntil: { not: null } }, data: { aiPausedUntil } })` — it may extend a running pause, it can never create one. The tap's own `pauseAssistant`, which asks `resolveSupportAsker` for a live membership first, stays the sole creator. |
| N3 (nit) | `partner.controller.ts` OpenAPI said the 404 was "not this shop's **and** still live", which is the opposite of the code | "not this shop's **or is already CLOSED**". Behaviour untouched; both branches were already pinned by `partner-support-tools.spec.ts`. |

Also, no behaviour change: `SUPPORT_REQUEST_ANSWERED_ACTION` / `SUPPORT_REQUEST_RESUME_ACTION` moved
to `external-signup/domain/support-request.constants.ts`. `send-partner-line-message.use-case.ts`
was importing the constant out of an `@Injectable()` use-case file in another module while
`external-signup` reaches back the other way — a cycle waiting to happen for the sake of a string.

## Open questions / follow-ups (not in this change)

- An UNLINKED prospect's follow-up text still hits the entry-door card, above the pause gate, so it
  is not appended (F8 above — recorded, unchanged, and asymmetric with the photo lane).
- A receipt photo sent during a live support thread is still OCR'd and answered by the assistant —
  the media lane has no pause gate. Out of scope here; since round 3 the photo leaves a
  `lastMediaAt` marker and nothing else, so it neither reopens the request nor extends the mute.
- The partner box WITHOUT a `supportRequestId` still marks every OPEN request of the shop ANSWERED
  (§2.3 as written since 2026-09-05). Answering the owner about billing therefore still clears an
  employee's unrelated request off the tab. Named sends no longer do this — they move only the
  request they name — so the fix, if the Owner wants one, is to make the inbox link the only route.
- `LineSupportRequest` now carries two bounded strings (`requestText`, `lastMessageText`) and two
  stamps; all of them die with the row at 90 days, and the purge was not touched.

## Artifacts

- Schema: `apps/api/prisma/schema.prisma` — `LineSupportRequest.lastMessageAt DateTime @default(now())`,
  `reopenedCount Int @default(0)`, plus (round 2) `requestText String?`, `lastMediaAt DateTime?` and
  `@@index([status, lastMessageAt])`. Names taken from `CrmConversation`, which already models the
  same idea; `lastMessageAt` NOT nullable because the tap itself is a message, which keeps
  `ORDER BY` simple.
- Migration: `apps/api/prisma/migrations/20260906120000_line_support_request_continuity/migration.sql`
  — four `ADD COLUMN`s, the index, and two backfills (`lastMessageAt` = `requestedAt`, `requestText`
  = `lastMessageText`) so existing rows neither claim they were written to at deploy time nor lose
  the only question they ever recorded. UNRELEASED, which is why round 2 extended this file rather
  than adding a second one.
- API: `process-line-webhook.use-case.ts` — `SUPPORT_FOLLOW_UP_REPLY`, `findLiveSupportRequest()`,
  `recordSupportFollowUp(lineUserId, requestId, { text? })` called from the pause gate (text) and
  `handleStaffContact` (the tap, no text), plus (round 3) `stampSupportMedia(lineUserId)` at the top
  of `executeReceiptUploadInner` — `lastMediaAt` alone, no reopen, no clock, no pause, no audit.
  Both are best-effort: they catch and warn (`line_support_follow_up_not_recorded` /
  `line_support_media_not_recorded`), and the follow-up returns false — so does a `count` of 0 — so
  a receipt is never lost and the customer never gets silence; the caller then sends the old,
  non-promising reply.
- API: `external-signup/domain/support-request.constants.ts` (round 3) — the two inbox audit
  actions, imported by `support-request-admin.use-case.ts` and `send-partner-line-message.use-case.ts`
  so the two modules no longer import each other's use cases in both directions.
- API: `line-signup-notify.service.ts` — the expiry sweep filters on `lastMessageAt`.
- API: `support-request-admin.use-case.ts` — `orderBy` now `[status asc, lastMessageAt desc]`; the
  DTO carries `requestText`, `lastMessageAt`, `lastMediaAt` and `reopenedCount`.
- API: `send-partner-line-message.use-case.ts` + `partner.controller.ts` — optional
  `supportRequestId`: loaded, fenced to this shop and to a non-CLOSED status (404 otherwise), added
  to the recipients, and marked ANSWERED with the inbox's own audit action. The audit still records
  only a count of recipients.
- Contracts: `packages/contracts/src/external-signup.ts` — `requestText`, `lastMessageAt`,
  `lastMediaAt`, `reopenedCount`, `PartnerLineMessageBody.supportRequestId`, and the corrected
  `delivered` doc.
- Web: `support-requests.logic.ts` — the wait window starts at `lastMessageAt` and ends only at a
  settling stamp that is not older than it; `supportReopenedChip()` prints the real count;
  `supportAnswerHref()` carries `?support=&asker=`. `SupportRequestsPage.tsx` shows the question,
  the newest message and the media marker. `app/system/partners/[companyId]/page.tsx` reads the two
  params; `PartnerDetailPage.tsx` shows "ตอบถึง: ผู้ขอ …" and sends `supportRequestId`.
- Spec: `docs/specs/line-support-request-spec-th.md` §2.2 delta รอบ 3 and รอบ 4.

## Verification (round 3, 2026-09-06, on the committed tree)

| Gate | Result |
|---|---|
| `line-first-signup-webhook.spec.ts` | 56 pass / 0 fail — **4 red first** (52/4): the two media cases, the re-arm case and the new unlinked case |
| `line-support-request.pg.spec.ts` (isolated `postgres:18.3-alpine`, 127.0.0.1:15481, `migrate deploy` + `sync-permissions`, container removed) | 16 pass / 0 fail — **2 red first** (14/2): the reviewer's mute probe failed `'OPEN' !== 'ANSWERED'`, the unlink probe failed `1 !== 0` context rows |
| N1 mutation: media lane back to `recordSupportFollowUp` | both media cases go RED, green again on restore |
| `line-intake-dispatch` + `process-line-webhook` use-case specs | 376 pass / 0 fail |
| `support-request-admin` + `partner-support-tools` | 41 pass / 0 fail (the constants move) |
| `line-signup-notify.service.spec.ts` + `spec-suite-coverage.spec.ts` | 36 pass / 0 fail (no package.json change: the constants file is not a spec) |
| `pnpm --filter @watchdog-bms/api typecheck` / `web typecheck` | clean |
| `node apps/api/scripts/check-di-metadata.mjs` | 795 files, 870 decorated classes, 820 with deps — all carry `design:paramtypes` |
| `pnpm --filter @watchdog-bms/api test:boot` | Nest resolved every provider in 132 ms |
| `pnpm --filter @watchdog-bms/api test` (full fixed list, under the heavy mutex) | exit 0, zero `✖`, 9606 dot-reporter marks |
| `pnpm --filter @watchdog-bms/web test` | 1604 pass / 0 fail |

N3 is documentation only: both 404 branches were already pinned by `partner-support-tools.spec.ts`
("refuses a request belonging to another shop" and "refuses a request that is already CLOSED"), and
the sentence was the only thing disagreeing with them. No new test — a decorator-metadata assertion
would pin the prose, not the behaviour.

Not run: `infra/docker/production-image-security.spec.sh` (out of scope), and no UAT deploy.

## Verification (round 2, 2026-09-06, all re-run on the committed tree)

| Gate | Result |
|---|---|
| `line-first-signup-webhook.spec.ts` | 55 pass / 0 fail (13 red first: 42/13 before the fixes) |
| `line-signup-notify.service.spec.ts` (F1 sweep) | 33 pass / 0 fail (1 red first) |
| `support-request-admin.use-case.spec.ts` | 12 pass / 0 fail (2 new, red first) |
| `partner-support-tools.spec.ts` | 29 pass / 0 fail (12 red first) |
| `line-intake-dispatch` + `process-line-webhook` use-case specs | 376 pass / 0 fail |
| `line-support-request.pg.spec.ts` (real Postgres, throwaway `postgres:18.3-alpine` on 127.0.0.1:15473, `migrate deploy` + `sync-permissions` first, container removed) | 14 pass / 0 fail (2 new; the F3 case was red on the un-regenerated client) |
| F6 mutation: `.slice(0, SUPPORT_LAST_MESSAGE_MAX_LENGTH)` removed | "stores at most 200 characters" goes RED (400 stored), green again on restore |
| `spec-suite-coverage.spec.ts` | 3 pass / 0 fail (no package.json change needed) |
| `pnpm --filter @watchdog-bms/api typecheck` | clean |
| `node apps/api/scripts/check-di-metadata.mjs` | 794 files, 870 decorated classes, 820 with deps — all carry `design:paramtypes` |
| `pnpm --filter @watchdog-bms/api test:boot` | Nest resolved every provider in 142 ms |
| `pnpm --filter @watchdog-bms/api test` (full fixed list, under the heavy mutex) | exit 0, zero `✖`, 9605 dot-reporter marks |
| `pnpm --filter @watchdog-bms/web typecheck` | clean |
| `pnpm --filter @watchdog-bms/web test` | 1604 pass / 0 fail |
| web `system-support-requests` / `system-partners` feature specs | 50 / 77 pass, 0 fail |
| `prisma validate` | valid |
| `prisma migrate diff --from-schema <develop 178d3fb6> --to-schema <branch> --script` | exactly four `ADD COLUMN`s (`lastMediaAt`, `lastMessageAt`, `reopenedCount`, `requestText`) + `CREATE INDEX LineSupportRequest_status_lastMessageAt_idx` |
| `prisma migrate diff --from-config-datasource` against the migrated test DB | no `LineSupportRequest` drift (only the repo-wide pre-existing truncated-index renames) |

Two pre-existing spec fakes (`line-intake-dispatch.use-case.spec.ts`,
`process-line-webhook.use-case.spec.ts`) had no `lineSupportRequest` model at all, so the new media
lookup threw and one of them lost a receipt turn. Completing the fakes (`findFirst → null`) was the
fix; the guard inside `recordSupportFollowUp` is what keeps that class of failure non-fatal in
production.

Not run: `infra/docker/production-image-security.spec.sh` (out of scope), and no UAT deploy.

## Next

- Owner acceptance on UAT: open the request from `/system/support-requests` with "เปิดหน้าร้าน" (the
  box must say "ตอบถึง: ผู้ขอ …"), answer from it, then reply from the customer's LINE — the row must
  return to รอตอบ with "ตอบแล้ว 1 ครั้ง · ลูกค้าตอบกลับ", the question must still be the first line of
  the message cell, and the header badge must count it again. Send a photo too: "📷 ส่งรูปมา" beside
  the words, never instead of them — and, after round 3, a photo on an ANSWERED row must LEAVE it
  ANSWERED: the camera appears on the ตอบแล้ว tab and the row does not come back to รอตอบ.
- The follow-ups above are unfixed by design; none of them is the reported defect.
