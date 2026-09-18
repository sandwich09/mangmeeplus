# Reconciling held AI credit — browser evidence, 2026-09-18

Phase H3 of the [hold-reconciliation spec](../../../specs/line-ai-credit-hold-reconciliation-spec-th.md)
(§4.1–4.2; acceptance J-05, and the Thai history rows J-05 asks for). Real HTTP, real DOM, real
logins, real money movements: every number below came out of PostgreSQL through the NestJS route,
was decided by pressing the real button, and was rendered by the Next.js page. Nothing is mocked
and nothing is stubbed in the browser.

- Base commit: `4aedd5c3a5e0d90000506449f24e7ce79230b765` (branch
  `codex/line-ai-wave2-h3-hold-reconciliation-20260918`, which already carries H1 and H2).
- Playwright + chromium, **12 subjects × 1440 px and 390 px** (24 images, 1.1 MB total). These are
  **element** crops — the section, the table, one modal, the position panel, the history card — not
  full pages.
- Each crop is clipped out of ONE `fullPage` capture, because a stitched element screenshot
  repaints the app shell's `sticky` header over the middle of anything taller than the viewport
  (the H1 bundle hit exactly that).
- Every 390 px capture asserts `scrollWidth - clientWidth <= 1`; the manifests record the measured
  overflow, which is **0 px** for all 24. The six-column hold table still scrolls **inside its own
  container**, which is why the 390 px shots show ประเภทงาน / ส่วน / เครดิตที่กันไว้ / เรียกเมื่อ
  and not all six columns.
- Nine subjects **assert** as well as photograph, because a photograph cannot prove an absence: the
  no-hold company really renders no table, the ARCHIVED company and the read-only operator really
  carry zero buttons, the breach company really offers only รับทราบ, and the history really contains
  all four Thai phrases.
- No uncaught JavaScript error and no application console error fired on any captured page
  (asserted; `captured-*.json` lists them, all empty). Two classes of `next dev` noise are filtered
  and named in the script: the HMR chunk vs the CSP nonce, and the pre-login 401 from
  `/api/auth/refresh`.
- No cloud, no LINE, no AI provider: `MODEL_PROVIDER=disabled` and `AI_GATEWAY_ENABLED=false` in the
  throwaway stack below, so no model can be called and every read and write here is database-only.
  No real tenant, person, LINE id or card appears in any image.
- `AI_BUDGET_SPLIT_ACTIVATION_ENABLED=true` existed only in the environment of the throwaway API
  process started here. It is already the deploy default (PR #622) and this bundle changes nothing.

## What each screenshot proves

Each subject has a `-1440.png` and a `-390.png`. `captured-1440.json` / `captured-390.json` (and the
two `captured-readonly-*.json`) are the manifests the capture script wrote, with each file's byte
size, its clipped band and the measured page overflow.

| Subject | Proves |
| --- | --- |
| `holds-empty` | A SPLIT company with spend and **no hold**: the heading **"เครดิตที่กันไว้ค้าง"**, the sentence that the system never releases held credit on a timer, the two months it covers, and the single line **"ไม่มีรายการค้าง"**. Asserted: no table element at all |
| `holds-with-rows` | Two `UNRESOLVED` holds: the six columns (ประเภทงาน / ส่วน / เครดิตที่กันไว้ / เรียกเมื่อ / อายุ / สถานะ), the Thai step labels **"แชตกับผู้ช่วย AI"** and **"อ่านใบเสร็จ"**, the shortened invocation keys, ages **"3 ชั่วโมง"** and **"1 วัน"**, both per-row buttons, the required reason box and the help line |
| `holds-breach-row` | A breach row: **฿4.70** held with **ใช้จริง ฿17.80** beside it, status **"ใช้เกินที่กันไว้"**, and **only** the **"รับทราบ"** button — no release, no charge. Asserted: exactly one รับทราบ button on the page |
| `holds-locked-company` | An **ARCHIVED** company: the hold and every number are visible and every button is gone, with the reason named ("บริษัทนี้อ่านได้อย่างเดียวตามสถานะบริษัท…"). Asserted: zero release buttons |
| `holds-read-only-operator` | A **real login without `system.partner_ai_model.manage`**: both hold rows and all their money, no buttons, no reason box, and **"บัญชีของคุณดูรายการได้ แต่ยังไม่มีสิทธิ์ปล่อยหรือคิดเครดิตที่กันไว้"**. Asserted: zero buttons and zero reason boxes, two rows still rendered |
| `holds-release-confirm` | The confirm dialog for a release, clipped to the modal: the amount, that the credit **returns to the shop immediately**, that **no cost is recorded**, when to do it, the late-evidence promise **"ถ้ามีหลักฐานการใช้จริงมาถึงภายหลัง ระบบจะบันทึกยอดจริงเพิ่มเอง"**, and the typed reason |
| `holds-after-release` | After pressing **ปล่อยเครดิตที่กันไว้**: that row is gone from the list, the remaining rows are untouched, and the toast confirms the released amount |
| `holds-charge-confirm` | The confirm dialog for charge-at-bound: that the amount becomes **real spend of this month**, and that it is **"ยอดที่กันไว้ ไม่ใช่ยอดที่วัดจากผู้ให้บริการ จึงไม่นับเป็นจำนวนครั้งที่เรียกโมเดล"** |
| `holds-after-charge` | The position panel of the SAME company after the charge, which is where the money is visible: **AI อ่านเอกสาร ใช้แล้ว ฿18.05** (was ฿15.00 — exactly the ฿3.05 bound), **กันไว้ระหว่างเรียก AI ฿0.00**, **เหลือใช้ได้ ฿41.95**, and the toast **"บันทึกค่าใช้จ่าย ฿3.05 แล้ว"** |
| `holds-acknowledge-confirm` | The confirm dialog for an acknowledgement: **ใช้จริง ฿6.40 จากที่กันไว้ ฿0.85**, that the scope **reopens**, that the recorded amount does not change and **no credit is returned**, and the warning to check the cap first |
| `holds-after-acknowledge` | After **รับทราบ**: the list is empty, so nothing on this company is closing a scope any more — the ADR 0013 §11.6 "until an operator clears it" promise, finally reachable |
| `holds-history` | The **ประวัติการปรับ AI** card: the three decisions in Thai, newest first, each with its actor, its timestamp and its reason — **"การรับทราบรายการใช้เกินที่กันไว้: ยังไม่รับทราบ → รับทราบแล้ว"**, **"เครดิตที่กันไว้ค้าง: ยังไม่ทราบผล → คิดเป็นค่าใช้จ่ายแล้ว"** and **"…→ ปล่อยเครดิตคืนแล้ว"**. Asserted: all four phrases present |

## How the read-only operator was reached, and what that says about the product

`canManage: false` is an API fact (the caller lacks `system.partner_ai_model.manage`), but the
platform shell gate above it is **role**-based: `apps/web/app/system/layout.tsx` admits only
`isSystemAdmin`, i.e. a membership carrying the `SYSTEM_ADMIN` role key, and that role holds every
`system.*` permission. So **no real login can reach this page with `canManage: false` today** — the
read-only operator the API and the page are both built for has no role to be.

Rather than photograph a faked flag, the capture removes that ONE permission from the `SYSTEM_ADMIN`
role **in the throwaway database**, logs in for real, captures, and puts it back (the two `psql`
statements are in the commands below, and the restore is verified). The seeded `h3.readonly` user
with a purpose-built read-only role is in the seed script and is refused by that shell gate, which
is how the gap was found. Worth an owner decision; it is not something H3 should change on its own.

## Not captured here

- The gateway halves of the spec (§3: the durable settle-evidence queue and the SIGTERM drain) are
  not web pages. They are covered by unit tests in
  `apps/ai-gateway/src/common/usage/ai-usage.interceptor.spec.ts` (a fake API that fails then
  succeeds, the overflow, the expiry, the drain summary, the shutdown hook).
- The concurrency and aggregate properties of the three decisions (two operators racing, the charge
  landing once, acknowledgement reopening admission, late evidence after a release) are
  `apps/api/src/modules/line-ai/application/company-ai-credit-holds.pg.spec.ts` against real
  PostgreSQL — a browser cannot prove serialization.
- The 15-minute ops alert (§5) has no page: it is a notification event plus a LINE push, asserted in
  `signup-ops-alert.service.spec.ts`.
- UAT and production journeys: this is a local stack. **J-08 stays open.**

## Exact commands

An isolated throwaway stack: unique ports, a unique database name, its own containers. It never
touches ports 15432 / 15439 / 15442 / 16390 / 19000 / 3000 / 3001, any existing container, or
`migrate reset`.

```sh
# 1. throwaway infrastructure
docker run -d --name mangmee-h3-pg -p 127.0.0.1:15487:5432 \
  -e POSTGRES_USER=watchdog -e POSTGRES_PASSWORD=watchdog_local_password -e POSTGRES_DB=h3_holds \
  postgres:16-alpine
docker run -d --name mangmee-h3-redis -p 127.0.0.1:16387:6379 redis:7-alpine

# 2. schema + the repo's own seed. Do NOT export S3_ENDPOINT here: the seed's attachment-storage
#    step then tries to reach a MinIO that this stack does not run.
export DATABASE_URL='postgresql://watchdog:watchdog_local_password@127.0.0.1:15487/h3_holds?schema=public'
(cd apps/api && ./node_modules/.bin/prisma migrate deploy)
(cd apps/api && APP_ENV=local NODE_ENV=development \
  CREDENTIAL_ENCRYPTION_KEY=<64 hex> PDPA_PSEUDONYMIZATION_KEY=<64 hex> \
  ../../node_modules/.bin/tsx prisma/seed.ts)

# 3. the five evidence companies + the read-only operator (throwaway DB only; the script refuses
#    any other DATABASE_URL)
MONTH_KEY=2026-09 tsx <scratch>/seed-h3-states.ts

# 4. build and boot: API on 3087, web dev on 3088. CORS_ALLOWED_ORIGINS must list the SAME host the
#    browser uses (127.0.0.1), or the three POST routes answer 500 "Origin is not allowed by CORS"
#    while the GETs still pass.
pnpm --filter @watchdog-bms/config build
pnpm --filter @watchdog-bms/contracts build
API_DIST_DIR=dist/h3-3087 pnpm --filter @watchdog-bms/api build
<scratch>/env.sh; node apps/api/dist/h3-3087/apps/api/src/main.js          # PORT=3087
<scratch>/env.sh; SERVICE_NAME=web NEXT_DIST_DIR=.next/h3-evidence PORT=3088 \
  pnpm --filter @watchdog-bms/web dev

# 5. one capture run per viewport. The three actions CHANGE state, so the synthetic rows are reset
#    and re-seeded between runs.
RESET="DELETE FROM \"AiBudgetReservation\" WHERE \"companyId\" LIKE 'h3-%';
       DELETE FROM \"AiUsageEvent\" WHERE \"companyId\" LIKE 'h3-%';
       DELETE FROM \"CompanyAiMonthlyBucketUsage\" WHERE \"companyId\" LIKE 'h3-%';
       DELETE FROM \"CompanyAiMonthlyUsage\" WHERE \"companyId\" LIKE 'h3-%';
       DELETE FROM \"AuditLog\" WHERE \"companyId\" LIKE 'h3-%';"
for vp in desktop mobile; do
  docker exec mangmee-h3-pg psql -U watchdog -d h3_holds -c "$RESET"
  MONTH_KEY=2026-09 tsx <scratch>/seed-h3-states.ts
  OUT_DIR=docs/qa/evidence/line-ai-credit-holds-2026-09-18 VIEWPORT=$vp node <scratch>/capture.mjs
done

# 6. the read-only operator, around a permission the throwaway role loses and gets back
for vp in desktop mobile; do
  docker exec mangmee-h3-pg psql -U watchdog -d h3_holds -c \
    "DELETE FROM \"RolePermission\" WHERE \"roleId\"=(SELECT id FROM \"Role\" WHERE \"scopeKey\"='system' AND key='SYSTEM_ADMIN') \
     AND \"permissionId\"=(SELECT id FROM \"Permission\" WHERE key='system.partner_ai_model.manage');"
  OUT_DIR=docs/qa/evidence/line-ai-credit-holds-2026-09-18 VIEWPORT=$vp ONLY=readonly node <scratch>/capture.mjs
  docker exec mangmee-h3-pg psql -U watchdog -d h3_holds -c \
    "INSERT INTO \"RolePermission\" (\"roleId\",\"permissionId\") SELECT \
     (SELECT id FROM \"Role\" WHERE \"scopeKey\"='system' AND key='SYSTEM_ADMIN'), \
     (SELECT id FROM \"Permission\" WHERE key='system.partner_ai_model.manage') ON CONFLICT DO NOTHING;"
done

# 7. teardown
docker rm -f mangmee-h3-pg mangmee-h3-redis
git checkout -- apps/web/next-env.d.ts    # `next dev` rewrites this tracked file to its distDir
rm -f apps/web/AGENTS.md apps/web/CLAUDE.md
rm -rf apps/web/.next/h3-evidence apps/api/dist/h3-3087
```

The two scripts live under the session scratch directory, not in the repo: they exist to produce
this bundle and have no place in the product or in CI.

### Seeded states behind the screenshots

Asia/Bangkok month `2026-09`, trial numbers from the wave-2 spec §7 (chat ฿80 / OCR ฿60 of ฿140).
All money is integer satang in the database; every hold is aged past the 30-minute `DISPATCHED`
threshold so the operator's own sweep leaves it `UNRESOLVED` instead of moving it.

| Company | State | Subject |
| --- | --- | --- |
| `h3-empty` | SPLIT, ฿12.40 chat / ฿19.10 OCR spent, **no reservation at all** | `holds-empty` |
| `h3-holds` | SPLIT, same spend, one `UNRESOLVED` OCR hold (฿3.05, 31 h) and one `UNRESOLVED` CHAT hold (฿1.20, 3 h) | `holds-with-rows`, `holds-read-only-operator` |
| `h3-breach` | SPLIT, a `SETTLED` OCR row whose actual ฿17.80 is above its ฿4.70 bound (`breach = true`, unacknowledged) plus one `UNRESOLVED` CHAT hold | `holds-breach-row` |
| `h3-locked` | **ARCHIVED**, one `UNRESOLVED` CHAT hold (฿0.90, 73 h) | `holds-locked-company` |
| `h3-act` | SPLIT, ฿11.00 chat / ฿15.00 OCR spent; one `UNRESOLVED` OCR hold ฿3.05, one `UNRESOLVED` CHAT hold ฿1.20, and one unacknowledged breach (bound ฿0.85, actual ฿6.40) — released, charged and acknowledged in that order during the run | `holds-release-confirm` … `holds-history` |

The System Admin is the repo seed's own platform account (`thawatchai.watchdog`) in the throwaway
database, and the capture logs in through the real `/login` form.
