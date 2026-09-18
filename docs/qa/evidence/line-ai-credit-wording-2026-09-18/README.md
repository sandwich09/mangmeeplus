# "เครดิต AI" wording and the held-credit warnings — browser evidence, 2026-09-18

Phase H1 of the [credit-wording and deterministic-reads spec](../../../specs/line-ai-credit-wording-and-deterministic-reads-spec-th.md)
(§3, §5.2, §5.3; acceptance W-01, W-04, W-08). Real HTTP, real DOM, real screenshots: every number
below came out of Postgres through the NestJS route and was rendered by the Next.js page. Nothing is
mocked and nothing is stubbed in the browser.

- Base commit: `5d158ff0fb09cd6fac952f078e763413417430bd` (branch `codex/line-ai-wave2-h1-credit-wording-20260918`),
  with the H1 working tree applied.
- Playwright + chromium, **7 subjects × 1440 px and 390 px**. These are **element** crops (a card, a
  band of a card, a warning box, the "unchanged" panel), not full pages.
- Each crop is taken from ONE `fullPage` capture and clipped to the element's document-absolute box.
  A stitched element screenshot repaints the app shell's `sticky` header over the middle of anything
  taller than the viewport, which was very visible on the 390 px position panel.
- Every 390 px capture asserts `scrollWidth - clientWidth <= 1`, so this bundle cannot contain a
  screenshot of a page that scrolls sideways. The four-money-column table still scrolls **inside its
  own container** (that is the existing design), which is why the 390 px position shots show
  ส่วน / เพดาน / ใช้แล้ว and not all five columns.
- Three subjects assert as well as photograph, because a photograph cannot prove an absence: the
  no-hold company really carries no `AI_CREDIT_HOLDS_PENDING` line, the holds-only company really
  does not claim exhaustion, and the hold warning really contains no digit.
- No client-side error fired on any captured page (asserted).
- No cloud, no LINE, no AI provider: no model is configured in the stack below, `BILLING_MODE=test`
  with no `STRIPE_SECRET_KEY` so no Stripe request can succeed, and every read here is DB-only. No
  real tenant, person, LINE id or card appears in any image.
- `AI_BUDGET_SPLIT_ACTIVATION_ENABLED=true` existed only in the environment of the throwaway API
  process started here. It is already the deploy default (PR #622) and this bundle changes nothing.

## What each screenshot proves

Each subject has a `-1440.png` and a `-390.png`; `captured-1440.json` / `captured-390.json` are the
manifests the capture script wrote, with each file's byte size and clipped band.

| Subject | Proves |
| --- | --- |
| `partner-ai-credit-shared` | Head of the partner **AI และโควตา** card on a SHARED company: the section heading **"การใช้งานและเครดิต AI"**, the sentence **"เครดิต AI ต่อเดือนของบริษัทนี้ — ใช้หมดเมื่อไร …"** and **"ใช้เดือนนี้ ฿42.00 จากเครดิต ฿140.00"** |
| `partner-ai-credit-form` | The credit form on the same card: **"เหตุผลที่ปรับเครดิต AI"** (visible label and `aria-label`), **"เครดิต AI ต่อเดือน (บาท)"**, the button **"ตรวจเครดิตก่อนบันทึก"**, the diff line **"เครดิต AI: ฿140.00 → ฿140"** and **"เว้นว่างเพื่อใช้เครดิตเริ่มต้น …"** — the exact strings `apps/api/src/scripts/admin-ai-adjustments-smoke.ts` pins |
| `partner-ai-credit-shared-position` | The position panel on the SAME SHARED company: **"แยกเพดานเครดิต AI ของบริษัทนี้"**, mode **"เครดิตรวมก้อนเดียว"**, the scope row **"เครดิตรวมทั้งเดือน"**, the reserved column headed **"กันไว้ระหว่างเรียก AI"**, the footnote **"… คือเครดิตที่ระบบกันไว้ให้งานที่กำลังเรียก AI อยู่ …"**, **"โหมดเครดิต AI"** and **"บันทึกเพดานเครดิต AI"** |
| `partner-ai-credit-split-holds` | The same panel on a SPLIT company with live holds: per-scope caps ฿80 / ฿60 of ฿140 (spec §7 trial numbers), the reserved column populated per scope (฿1.20 CHAT, ฿6.10 OCR, ฿7.30 total), the rewritten unresolved-hold notice **"มี 1 รายการที่ยังไม่ทราบผลจากผู้ให้บริการ AI — เครดิตส่วนนั้นยังถูกกันไว้จนกว่าจะได้ผลจริง"**, and **"ผลรวมเพดานต้องไม่เกินเครดิตรวมที่บันทึกไว้ ฿140.00 … เครดิตรวมด้านบนต้องบันทึกก่อน"** |
| `billing-receipt-warnings-no-holds` | Receipt-adjustments read warnings on a company with **no hold**: exactly the three pre-existing lines, with `AI_BUDGET_REACHED` now reading **"ร้านนี้ใช้เครดิต AI ของเดือนนี้หมดแล้ว"** and the footer **"… ตรวจที่เมนูเครดิตการใช้ AI …"**. Asserted: no `AI_CREDIT_HOLDS_PENDING` line |
| `billing-receipt-warnings-holds` | The new **`AI_CREDIT_HOLDS_PENDING`** warning **alone**, on a company whose credit is not exhausted: **"มีงาน AI ที่กำลังทำอยู่หรือยังไม่ทราบผล ระบบกันเครดิตไว้ชั่วคราว เครดิตที่ใช้ได้จริงอาจต่ำกว่าที่แสดง ตรวจได้ที่หมวด AI และโควตา"**. Asserted: it claims no exhaustion and contains no digit |
| `billing-plan-credit-holds` | The plan-adjustments **"ที่คงเดิม"** panel with holds: **"เครดิต AI เดือนนี้ 140 บาท · ใช้แล้ว 51.3 บาท · กันไว้ระหว่างเรียก AI 9.93 บาท"** plus **"มี 1 รายการที่ยังไม่ทราบผลจากผู้ให้บริการ AI เครดิตส่วนนั้นยังถูกกันไว้"** — the two additive fields `aiReservedSatang` / `aiUnresolvedHolds` rendered from a real snapshot |

Every image also shows the System Admin sidebar item now reading **"เครดิตการใช้ AI"** where a screen
region includes it, and none of the 14 images contains "งบ AI" or "โควตา AI".

## Not captured here

- The LINE surfaces (picture-lane refusal, chat Flex card, drain notice). They are not web pages;
  they are covered by unit/regression specs and by the whole-chain runner, and the real LINE
  transcript is **W-09**, which stays open until a UAT deploy.
- The SHARED position panel's `ยังไม่ตั้ง` caps and the per-scope table's other states are D2's
  bundle ([`../ai-budget-split-2026-09-17/`](../ai-budget-split-2026-09-17/README.md)); nothing in H1
  changed that behaviour, only its words.
- Loading / error / permission states of these pages: pre-existing behaviour, unchanged by H1.
- UAT and production journeys: this is a local stack.
- `apps/api/src/scripts/admin-ai-adjustments-smoke.ts` (CI's own browser smoke, updated in H1 for the
  new selectors) was **not** run: it drives the combined `billing-http-smoke` harness with Stripe
  fixtures and a second browser context, which the throwaway stack above does not provide. Its
  selectors are the strings `partner-ai-credit-form` photographs.

## Exact commands

An isolated throwaway stack: unique ports, a unique database name, its own containers. It never
touches ports 15432 / 15439 / 15442 / 16390 / 19000 / 3000 / 3001, any existing container, or
`migrate reset`.

```sh
# 1. throwaway infrastructure
docker run -d --name mangmee-h1-evidence-pg -p 127.0.0.1:15484:5432 \
  -e POSTGRES_USER=watchdog -e POSTGRES_PASSWORD=watchdog_local_password -e POSTGRES_DB=h1_evidence \
  postgres:16-alpine
docker run -d --name mangmee-h1-evidence-redis -p 127.0.0.1:16384:6379 redis:7-alpine

# 2. schema + the repo's own seed. Do NOT export S3_ENDPOINT here: the seed's attachment-storage
#    step then tries to reach a MinIO that this stack does not run.
export DATABASE_URL='postgresql://watchdog:watchdog_local_password@127.0.0.1:15484/h1_evidence?schema=public'
(cd apps/api && ./node_modules/.bin/prisma migrate deploy)
(cd apps/api && APP_ENV=local NODE_ENV=development \
  CREDENTIAL_ENCRYPTION_KEY=<64 hex> PDPA_PSEUDONYMIZATION_KEY=<64 hex> \
  ../../node_modules/.bin/tsx prisma/seed.ts)

# 3. the five evidence companies (throwaway DB only; the script refuses any other DATABASE_URL)
MONTH_KEY=2026-09 tsx <scratch>/seed-h1-states.ts

# 4. build and boot: API on 3084, web dev on 3085. Beyond the usual local env this needs
#    BILLING_MODE=test and STRIPE_ACCOUNT_ID=acct_TESTONLYH1EVIDENCE (matching the seeded
#    BillingAccount), or `scopedCompany` resolves no account and the plan panel never renders.
pnpm --filter @watchdog-bms/config build
pnpm --filter @watchdog-bms/contracts build
API_DIST_DIR=dist/h1-3084 pnpm --filter @watchdog-bms/api build
<scratch>/env.sh; node apps/api/dist/h1-3084/apps/api/src/main.js          # PORT=3084
<scratch>/env.sh; SERVICE_NAME=web NEXT_DIST_DIR=.next/h1-evidence PORT=3085 \
  pnpm --filter @watchdog-bms/web dev

# 5. one capture run per viewport (the pages here are read-only, so no re-seed in between)
for vp in desktop mobile; do
  OUT_DIR=docs/qa/evidence/line-ai-credit-wording-2026-09-18 VIEWPORT=$vp node <scratch>/capture.mjs
done

# 6. teardown
docker rm -f mangmee-h1-evidence-pg mangmee-h1-evidence-redis
git checkout -- apps/web/next-env.d.ts    # `next dev` rewrites this tracked file to its distDir
rm -f apps/web/AGENTS.md apps/web/CLAUDE.md
rm -rf apps/web/.next/h1-evidence apps/api/dist/h1-3084
```

The two scripts live under the session scratch directory, not in the repo: they exist to produce this
bundle and have no place in the product or in CI.

### Seeded states behind the screenshots

Asia/Bangkok month `2026-09`. All money is in satang in the database.

| Company | State |
| --- | --- |
| `h1-shared` | `SHARED`, ฿140.00 total (spec §7), ฿42.00 spent, OCR on with a 15-read limit, **no** reservation |
| `h1-split-holds` | `SPLIT` ฿80.00 chat / ฿60.00 OCR of ฿140.00; ฿12.40 CHAT and ฿19.10 OCR spent; a `DISPATCHED` OCR hold (฿3.05), a `RESERVED` CHAT hold (฿1.20) and an `UNRESOLVED` OCR hold (฿3.05) |
| `h1-bill-clean` | Paid PRO term + billing account; OCR **off**, read count 1 of 1, total credit spent to the satang — and **no** reservation, so the warning list is today's three |
| `h1-bill-holds` | Paid PRO term; credit left in every scope; a `DISPATCHED` OCR hold and an `UNRESOLVED` CHAT hold — so the hold warning is the only line |
| `h1-plan-holds` | Paid PRO term; ฿51.30 spent of ฿140.00; ฿6.10 + ฿3.05 + ฿0.78 held, one of them `UNRESOLVED` |

The System Admin is the repo seed's own platform account (`thawatchai.watchdog`) in the throwaway
database, and the capture logs in through the real `/login` form and the real clickwrap endpoint.
