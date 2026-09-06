# Agent Memory: support-request-continuity

Status: DONE (gates green, not deployed) — branch `codex/support-request-continuity` from
`origin/develop` (178d3fb6); no PR opened
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
  └──(customer text or photo, reopenedCount += 1)──────────┘
OPEN/ANSWERED ──(customer resume | admin resume | 24h sweep)──▶ CLOSED   (never reopened)
```

- `answeredAt` / `answeredByUserId` are kept as the history of the last answer.
- `reopenedCount` counts answer→customer-reply round trips; the inbox chip reads it.
- `lastMessageAt` is the newest customer message, and the waiting clock counts from it.
- CLOSED is terminal: a fresh "ติดต่อเจ้าหน้าที่" opens a new row (existing §2.2.4 behaviour).

## Decisions

- Two call sites only, not a global choke point: the pause gate (text) and the top of the media
  lane. A lookup on every text event would put an extra query on the hot path for a case that
  cannot happen (no request → nothing to append).
- Schema delta is two additive columns on `LineSupportRequest`; no new table, no new index —
  `@@index([lineUserId, status])` already serves the follow-up lookup.
- `updatedAt` was rejected as the "latest customer message" stamp: the drain (`notifiedAt`) and the
  admin buttons write it too, so it cannot say a customer wrote.

## Open questions / follow-ups (not in this change)

- An UNLINKED prospect's follow-up text still hits the entry-door card, above the pause gate, so it
  is not appended. They have no pause (nothing to silence), so the reported defect does not apply,
  but the same silence exists for them.
- A tap on "ติดต่อเจ้าหน้าที่" while a request is ANSWERED still creates a SECOND row
  (`handleStaffContact` dedupes on OPEN only). Consistent with §2.2.4 as written; worth revisiting.
- A receipt photo sent during a live support thread is still OCR'd and answered by the assistant —
  the media lane has no pause gate. Out of scope here; it also means a plain receipt can reopen a
  request ("ลูกค้าส่งรูปภาพมา" in the cell tells the operator what it was).
- A follow-up does NOT re-arm the 24 h pause, which is still measured from the original tap. So a
  request reopened at hour 23 is swept `expired` an hour later even though nobody answered it. That
  is the pre-existing lifecycle of any OPEN request (`sweepExpiredSupportRequests` closes on the
  lapsed pause, not on the answer), so it is not a regression — but it is the next thing to fix if
  the Owner sees reopened rows disappearing.

## Artifacts

- Schema: `apps/api/prisma/schema.prisma` — `LineSupportRequest.lastMessageAt DateTime @default(now())`,
  `reopenedCount Int @default(0)`. Names taken from `CrmConversation`, which already models the same
  idea; NOT nullable here because the tap itself is a message, which keeps `ORDER BY` simple.
- Migration: `apps/api/prisma/migrations/20260906120000_line_support_request_continuity/migration.sql`
  — two `ADD COLUMN`s plus `UPDATE … SET "lastMessageAt" = "requestedAt"` so existing rows do not
  claim they were written to at deploy time.
- API: `process-line-webhook.use-case.ts` — `SUPPORT_FOLLOW_UP_REPLY`, `SUPPORT_PHOTO_PREVIEW`,
  `recordSupportFollowUp()`, called from the pause gate (text) and the top of
  `executeReceiptUploadInner` (photo). Best-effort: it catches, warns
  `line_support_follow_up_not_recorded`, and returns false, so a receipt is never lost and the
  customer never gets silence — the caller then sends the old, non-promising reply.
- API: `support-request-admin.use-case.ts` — `orderBy` now `[status asc, lastMessageAt desc]`; the
  DTO carries `lastMessageAt` and `reopenedCount`.
- API: `send-partner-line-message.use-case.ts` — recipients are OWNERs ∪ the LINE ids on this shop's
  OPEN requests (item 4 below), deduped; the audit still records only a count.
- Contracts: `packages/contracts/src/external-signup.ts` — `lastMessageAt`, `reopenedCount`, and the
  corrected `delivered` doc.
- Web: `support-requests.logic.ts` — the wait window starts at `lastMessageAt` and never ends while
  `status === 'OPEN'`; new `supportReopenedChip()`. `SupportRequestsPage.tsx` renders the chip and
  stamps the row with `lastMessageAt` (the value the duration above it is measured from).
- Spec: `docs/specs/line-support-request-spec-th.md` §2.2 delta รอบ 3.

## Verification (2026-09-06, all re-run on the committed tree)

| Gate | Result |
|---|---|
| `line-first-signup-webhook.spec.ts` | 47 pass / 0 fail (9 new, red first) |
| `support-request-admin.use-case.spec.ts` | 10 pass / 0 fail |
| `partner-support-tools.spec.ts` | 23 pass / 0 fail (3 new) |
| `line-intake-dispatch` + `process-line-webhook` use-case specs | 376 pass / 0 fail |
| `line-support-request.pg.spec.ts` (real Postgres, isolated container :15437, `migrate deploy` first) | 12 pass / 0 fail (2 new) |
| `spec-suite-coverage.spec.ts` | 3 pass / 0 fail (no package.json change needed) |
| `pnpm --filter @watchdog-bms/api typecheck` | clean |
| `node apps/api/scripts/check-di-metadata.mjs` | 794 files, 870 decorated classes — all carry `design:paramtypes` |
| `pnpm --filter @watchdog-bms/api test:boot` | Nest resolved every provider in 138 ms |
| `pnpm --filter @watchdog-bms/api test` (full fixed list, under the heavy mutex) | exit 0, 9587 dot-reporter tests, zero `✖` |
| `pnpm --filter @watchdog-bms/web typecheck` | clean |
| `pnpm --filter @watchdog-bms/web test` | 1594 pass / 0 fail |
| `prisma validate` | valid |
| `prisma migrate diff --from-schema <HEAD> --to-schema <branch> --script` | emits exactly the two `ADD COLUMN`s in the migration — no drift |

Two pre-existing spec fakes (`line-intake-dispatch.use-case.spec.ts`,
`process-line-webhook.use-case.spec.ts`) had no `lineSupportRequest` model at all, so the new media
lookup threw and one of them lost a receipt turn. Completing the fakes (`findFirst → null`) was the
fix; the guard inside `recordSupportFollowUp` is what keeps that class of failure non-fatal in
production.

Not run: `infra/docker/production-image-security.spec.sh` (out of scope), and no UAT deploy.

## Next

- Owner acceptance on UAT: answer a request from the partner box, press "ตอบแล้ว", then reply from
  the customer's LINE — the row must return to รอตอบ with "ตอบแล้ว 1 ครั้ง · ลูกค้าตอบกลับ" and the
  header badge must count it again.
- The three follow-ups above are unfixed by design; none of them is the reported defect.
