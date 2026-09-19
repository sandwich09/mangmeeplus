# Buyer expense capture — browser evidence, 2026-09-19

W08 of the [capture plan](../../../plans/marketplace-buyer-expense-capture-plan-th.md) §5. Real HTTP,
real DOM, a real login through the real `/login` form and the real legal clickwrap: every number
below came out of PostgreSQL through the NestJS routes and was rendered by the Next.js pages.
Nothing is mocked in the browser.

The row-by-row acceptance verdicts live in [`acceptance-matrix.md`](./acceptance-matrix.md); this
file is what a person can SEE.

- Base commit: `b28c71855a1bfa3f8033df27af25fe8e02e6337c` (branch `codex/mkt-w08-acceptance-20260918`,
  which carries W01–W07-int and the two reader fixes the Bedrock benchmark found).
- Playwright + chromium, **13 subjects × 1440 px and 390 px** (26 images, 3.0 MB). These are
  **element** crops — a card, a section, one page's `<main>` — not stitched element screenshots.
- Each crop is clipped out of ONE `fullPage` capture. A stitched element screenshot repaints the app
  shell's sticky header over the middle of anything taller than the viewport; clipping avoids that,
  except that a very tall 390 px crop still contains the header band at its own viewport position
  (visible in `group-accepted-allocation-390.png`). That band is the app shell, not a page defect.
- Every 390 px capture **asserts** `scrollWidth - clientWidth <= 1`; the manifests record the
  measured overflow, which is **0 px** for all 13.
- **No uncaught JavaScript error and no application console error** fired on any captured page
  (asserted; `captured-1440.json` / `captured-390.json` list them, both empty).
- Three subjects assert as well as photograph, because a photograph cannot prove an absence: the
  open group really does say **"ยังไม่ทราบว่าใครเป็นคนจ่าย"**, the handed-off group really does
  offer **"รอตรวจภาษีก่อนเตรียมใบเบิก"** on the shop that still owes a tax decision, and the legacy
  expense page really carries **no** "จากกลุ่มหลักฐาน" badge.
- No cloud, no LINE, no AI provider: `MODEL_PROVIDER=disabled` and `AI_GATEWAY_ENABLED=false` in the
  throwaway stack below, and `S3_ENDPOINT` points at a dead local port so an evidence preview cannot
  reach any object store. Every read and write here is database-only.
- No real tenant, person, shop, LINE id or file appears in any image. The "uploaded" documents are
  `AttachmentObject` rows with a synthetic key and **no bytes behind them**, which is why the file
  cards render their state but a preview would not open.

## What each screenshot proves

Each subject has a `-1440.png` and a `-390.png`.

| Subject | Proves |
| --- | --- |
| `capture-list` | **(d)** `/expenses/capture`: งานรับหลักฐาน as its own list with its own statuses, next to — never inside — the expense list (A39/IG03) |
| `group-open-summary` | The §13.4 summary of a job still being read: shops/items with the "อ่านยังไม่ครบ" qualifier, ยอดจ่ายรวมที่พบ, **ส่วนของบริษัท: ยังไม่ได้จัดส่วน**, **ผู้จ่าย: ยังไม่ทราบว่าใครเป็นคนจ่าย**, and the four separate state chips of §13.2 — never one green tick |
| `group-open-blockers` | **ต้องตรวจก่อนทำต่อ** above the single primary action, every blocker carrying its own **ทางทำต่อ** (§13.4/§17.1) |
| `group-open-files` | Per-file read state: one file read, one **กำลังอ่านเอกสาร** with its page progress, one read of a third document — and the D09 line that the electronic check has not been done |
| `group-open-facts` | **(b)** Facts per document: a row whose amount the page never printed shows **ไม่ทราบ**, never 0 (A28); one document carries **ข้อมูลยังไม่พอสรุปยอด** because of that unknown row, and the coffee-shop document carries **ยอดไม่ตรง — ตรวจจุดที่ไม่ตรง** because its printed total is 60 baht above its rows (§6 rule 9 / UXE-16) |
| `group-open-questions` | **(b)** The two questions of spec §3 with **no default selected** on either — "ใช้สำหรับบริษัททั้งหมด / มีของส่วนตัวด้วย" and "เงินบริษัท / พนักงานสำรองจ่าย" |
| `group-accepted-allocation` | **(b)** The same section once both questions are answered: the per-item **ส่วนตัวกี่ชิ้น** steppers (including the unknown-amount row, held at 0 personal), the **ผู้จ่าย** select, the computed split per shop, **ดูที่มาการแบ่ง open** — ยอดตั้งต้น / ส่วนลดที่แบ่งมา (ปรับเศษสตางค์) / ค่าส่งที่แบ่งมา / ของบริษัท n จาก m หน่วย / รวมบรรทัดนี้ — and the **ยอมรับการจัดส่วนแล้ว** badge |
| `group-handed-derived` | **(b)** The two ordinary expenses one job produced: ร้านวัสดุ สมใจ ฿1,515.00 **claim-ready** with เตรียมใบเบิก and its PREPARED certificate row (**ใบรับรอง: รอลงนาม · SR-2026-0001**), beside ร้านเครื่องเขียน ปากน้ำ ฿780.00 which says **มีใบเสร็จใช้ได้** (A18: a shop with its own receipt is offered no certificate) and **รอตรวจภาษีก่อนเตรียมใบเบิก** |
| `expense-from-capture-group` | **(c)** A derived source's own review page: an ordinary expense that carries the **จากกลุ่มหลักฐาน** badge and a link back to the job it came from (§5 lineage) |
| `expense-list-legacy` | **(g)** The ordinary expense list: the legacy expense sits there with no capture badge, no extra column and no extra question (A01) |
| `expense-legacy-review` | **(g)** A legacy expense review page, asserted to carry **no** group badge — the page it always was (A01) |
| `reimbursement-source-derived` | **(e)** `/reimbursements/new?expenseId=…` opened on a derived source: the server, not the form, decides whether this requester may claim it (W07-int §23.2.14) |
| `substitute-from-derived` | **(f)** The substitute-receipt wizard started from a derived source, prefilled from the reviewed facts of the group (W06 §22.2) |

## Not captured here, and why

Named honestly rather than left to be assumed:

- **The upload panel's own per-file states** (uploading / ส่งไฟล์นี้อีกครั้ง after a transport
  failure). Those are a client-side state machine over a real `PUT` to object storage, and this
  stack deliberately has no object store. They are covered by
  `apps/web/src/features/expenses/expense-capture-upload.logic.spec.ts` and the panel's own QA spec.
- **A PDF read in progress on the expense review page** ("อ่านแล้ว n จาก m หน้า"), the failed-read
  notice without a reread button, the multi-document notice and the replace/append controls. Those
  need a live read job on a single-expense owner plus a real file to replace; the copy and the
  absence of the reread CTA are asserted in
  `apps/web/src/features/expenses/expense-capture-status.logic.spec.ts` and `ExpenseReviewPage`'s
  QA spec.
- **LINE**: nothing in this bundle goes near LINE. Never on a local stack, by rule.
- **UAT and production**: this is a local throwaway stack. Every deployed-environment row in the
  matrix stays `NOT_RUN`.

## Rollback note (A38/A47/IG13)

Turning this feature off, or rolling a binary back, is safe in one direction only, and the shape of
that is worth writing down beside the pictures:

- **The migrations are additive.** `20260918120000_expense_capture_foundation` adds six tables,
  twelve enums and four nullable columns on `ExpenseRecord`; `20260919120000_expense_capture_push_target`
  adds one nullable column and one partial unique index. Nothing existing is dropped, narrowed or
  renamed, so an older binary keeps reading and writing every row it already knew.
- **An old binary ignores the new tables** — it has no client for them — and the four lineage
  columns are nullable, so an ordinary expense it writes simply has them null. What an old binary
  must never do is *consume* a derived source as if it were its own: it cannot, because a derived
  source IS an ordinary expense with the same invariants (proven in
  `apps/api/src/modules/expenses/expense-capture-compatibility.spec.ts`).
- **The worker route is 404-gated**: the internal capture-read drain lives behind the worker token
  and does not exist on a binary that predates it, so a queued job simply waits.
- **Turning intake off is not a rollback.** `EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED=false` refuses
  NEW evidence only; reading, detaching, closing, finishing a reserved upload, the queued read and
  the handoff of a job that already holds its files all keep working (A47, asserted in
  `expense-capture-group.use-case.spec.ts`, `expense-capture-handoff.use-case.spec.ts` and
  `expense-capture-read-status.use-case.spec.ts`). After data exists, going back to a binary that
  does not understand it is NOT made safe by the flag — spec §14.3 says so, and this bundle changes
  nothing about that.

## Exact commands

An isolated throwaway stack: unique ports, a unique database name, its own containers. It never
touches ports 15432 / 15439 / 15442 / 16390 / 19000 / 3000 / 3001, any existing container, or
`migrate reset`.

```sh
# 1. throwaway infrastructure
docker run -d --name mangmee-w08-pg -p 127.0.0.1:15521:5432 \
  -e POSTGRES_USER=watchdog -e POSTGRES_PASSWORD=watchdog_local_password -e POSTGRES_DB=w08_capture \
  postgres:16-alpine
docker run -d --name mangmee-w08-redis -p 127.0.0.1:16391:6379 redis:7-alpine

# 2. schema + the repo's own seed
export DATABASE_URL='postgresql://watchdog:watchdog_local_password@127.0.0.1:15521/w08_capture?schema=public'
(cd apps/api && ./node_modules/.bin/prisma migrate deploy)
(cd apps/api && APP_ENV=local NODE_ENV=development \
  CREDENTIAL_ENCRYPTION_KEY=<64 hex> PDPA_PSEUDONYMIZATION_KEY=<64 hex> \
  ../../node_modules/.bin/tsx prisma/seed.ts)
#    The seed's last step reaches for object storage and fails with NoSuchBucket; everything the
#    pages need (users, roles, permissions, companies, branches) is already committed by then.
#    Set S3_ENDPOINT first (step 4) if you would rather it fail locally.

# 3. the capture states of this bundle (throwaway DB only; the script refuses any other host and
#    deletes its own `w08-*` rows first, so re-running is a clean re-run)
(cd apps/api && pnpm exec tsx \
  ../../docs/qa/evidence/marketplace-buyer-expense-capture-2026-09-19/seed-capture-evidence.ts)

# 4. build and boot: API on 3091, web dev on 3092. CORS_ALLOWED_ORIGINS must list the SAME host the
#    browser uses (127.0.0.1). S3_ENDPOINT points at a dead local port on purpose.
pnpm --filter @watchdog-bms/config build
pnpm --filter @watchdog-bms/contracts build
API_DIST_DIR=dist/w08-3091 pnpm --filter @watchdog-bms/api build
<scratch>/env.sh; node apps/api/dist/w08-3091/apps/api/src/main.js            # PORT=3091
<scratch>/env.sh; SERVICE_NAME=web NEXT_DIST_DIR=.next/w08-evidence PORT=3092 \
  pnpm --filter @watchdog-bms/web dev

# 5. one capture run per viewport (read-only: nothing here presses a mutating button)
for vp in desktop mobile; do
  OUT_DIR=docs/qa/evidence/marketplace-buyer-expense-capture-2026-09-19 VIEWPORT=$vp \
    node <scratch>/capture.mjs
done

# 6. teardown
docker rm -f mangmee-w08-pg mangmee-w08-redis
git checkout -- apps/web/next-env.d.ts    # `next dev` rewrites this tracked file to its distDir
rm -f apps/web/AGENTS.md apps/web/CLAUDE.md
rm -rf apps/web/.next/w08-evidence apps/api/dist/w08-3091
```

`env.sh` and `capture.mjs` live under the session scratch directory, not in the repo: they exist to
produce this bundle and have no place in the product or in CI. The seed script IS committed, here,
because without it the images cannot be reproduced.

### Seeded states behind the screenshots

All in the repo seed's own `WatchDog Local Company`, logged in as its seeded owner `qa.owner`.

| Id | State | Subjects |
| --- | --- | --- |
| `w08-expense-legacy` | An ordinary expense, no capture lineage at all | `expense-list-legacy`, `expense-legacy-review` |
| `w08-group-open` | OPEN, businessUse and fundingRoute both UNKNOWN; three files — one read (a row with no printed amount), one **READING** 1 of 4 pages, one read with a printed total 60 baht above its rows | `group-open-*` |
| `w08-group-reviewed` | OPEN, MIXED + พนักงานสำรองจ่าย, two shops, two stationery folders marked personal, allocation **ACCEPTED** (outcome READY, computed by `computeCaptureAllocation` itself — no typed-in numbers) | `group-accepted-allocation` |
| `w08-group-handed` | HANDED_OFF with two derived expenses: ร้านวัสดุ สมใจ ฿1,515.00 with a reviewed tax decision and a **PREPARED** certificate, ร้านเครื่องเขียน ปากน้ำ ฿780.00 still awaiting one | `group-handed-derived`, `expense-from-capture-group`, `reimbursement-source-derived`, `substitute-from-derived` |
