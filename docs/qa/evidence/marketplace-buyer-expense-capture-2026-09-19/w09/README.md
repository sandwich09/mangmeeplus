# W09 — no new screens (owner decision 2026-09-19): browser evidence

Appendix §25 of the [contract appendix](../../../../specs/marketplace-buyer-expense-capture-contract-appendix-th.md).
Every picture here is a `fullPage` screenshot of the real page on a throwaway local stack, taken by
[`e2e/expense-capture-intake.evidence.spec.ts`](../../../../../e2e/expense-capture-intake.evidence.spec.ts)
under the evidence projects `desktop-1440` (1440 px) and `iphone13-chromium` (390 px). The acceptance
behind the pictures is [`e2e/expense-capture-intake.spec.ts`](../../../../../e2e/expense-capture-intake.spec.ts)
(the two share [`e2e/harness/expense-capture.ts`](../../../../../e2e/harness/expense-capture.ts)).

`captured-1440.json` / `captured-390.json` record, per subject, the URL, the measured horizontal
overflow (`scrollWidth - clientWidth`, asserted `<= 1` at 390 px — measured **0 px** for all six subjects)
and the console/page errors (asserted empty — **none** on any subject at either width). No cloud, no LINE, no AI provider: `MODEL_PROVIDER=disabled`, `AI_GATEWAY_ENABLED=false`; the
object store is a throwaway MinIO. No real tenant, person, shop or file appears in any image — the
"documents" are a generated 1×1 PNG and a 4-line PDF.

## What each screenshot proves

| Subject | 1440 | 390 | Proves |
|---|---|---|---|
| `upload-three-files-picked` | ✓ | ✓ | the ORDINARY upload panel with three files picked: one row per file, no "ทำงานเดิมต่อ / เริ่มงานใหม่" question, no group |
| `list-after-three-files` | ✓ | ✓ | after "ให้ AI อ่านใบเสร็จ": three ordinary drafts, the list with the newest highlighted (`?highlight=`), no "งานรับหลักฐาน" link anywhere |
| `review-pdf-reading` | ✓ | ✓ | the PDF draft's review page while a read job is queued: "เก็บไฟล์แล้ว กำลังอ่านเอกสาร", the ordinary form underneath (the real job finishes in milliseconds here, so this state is photographed from a queued job the worker has not claimed yet, withdrawn right after) |
| `review-pdf-read-ended` | ✓ | ✓ | the engine's own verdict for that PDF on this stack (no AI provider, a 4-line PDF with nothing readable: PARTIAL): the §17.6 notice, NO "อ่านเอกสารอีกครั้ง" button, no "แยกเป็นกลุ่มหลักฐาน" |
| `review-auto-split-notice` (+ `-crop`) | ✓ | ✓ | one file that held two documents: "พบเอกสาร 2 ใบในไฟล์นี้ — สร้างรายการเพิ่มให้แล้ว" with a link to the draft the engine created; no button, no group page. The review page's sticky action bar repaints over the middle of a fullPage capture, so the notice is also cropped on its own |
| `review-single-image` | ✓ | ✓ | the legacy lane unchanged: one image → one draft → the detail page |

## The three lanes, in words

1. **Web upload (same page).** Several files = N ordinary single-file uploads, one at a time
   (`init → PUT → complete → extraction request` each). One file lands on its detail page, several
   land on the list with the newest highlighted. Nothing new is asked.
2. **Review page (same page).** Keeps the read-status line for a PDF, the §17.6 notices with no
   re-read, replace/append, and — only when the engine split a file — a one-line notice with links.
3. **LINE file (PDF).** An ordinary draft at intake; the read is the same `ownerType EXPENSE` job; the
   push carries the expense link(s). Proven by the LINE dispatch and notifier unit specs (the fake
   webhook drive), not by a picture: there is no screen.

## Exact commands (throwaway stack; unique ports, nothing shared)

```sh
docker run -d --name mangmee-w09-pg -p 127.0.0.1:15477:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=watchdog_bms postgres:16-alpine
docker run -d --name mangmee-w09-redis -p 127.0.0.1:16377:6379 redis:7-alpine
docker run -d --name mangmee-w09-minio -p 127.0.0.1:19077:9000 -e MINIO_ROOT_USER=watchdog -e MINIO_ROOT_PASSWORD=watchdog_local_secret minio/minio server /data
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:15477/watchdog_bms?schema=public'
(cd apps/api && ./node_modules/.bin/prisma migrate deploy && APP_ENV=local NODE_ENV=development GIT_SHA=local corepack pnpm exec tsx prisma/seed.ts)
# TWO steps the seed does not do, and without which the panel "does nothing":
(cd apps/api && APP_ENV=local NODE_ENV=development GIT_SHA=local corepack pnpm exec tsx prisma/sync-feature-launch-gates.ts)   # else 403 feature_temporarily_unavailable
aws --endpoint-url http://127.0.0.1:19077 --region us-east-1 s3api create-bucket --bucket w09-capture
aws --endpoint-url http://127.0.0.1:19077 --region us-east-1 s3api put-bucket-versioning --bucket w09-capture --versioning-configuration Status=Enabled   # else 500 on …/complete
# API 3077 + web dev 3078 with playwright.config.ts's localEnv (API_DIST_DIR=dist/e2e-3077, NEXT_DIST_DIR=.next/w09, S3_E2E=1,
# S3_ENDPOINT=http://127.0.0.1:19077, S3_BUCKET=w09-capture, MODEL_PROVIDER=disabled, WORKER_INTERNAL_TOKEN=<any>), then:
corepack pnpm exec playwright test e2e/expense-capture-intake.spec.ts --project=chromium --workers=1
corepack pnpm exec playwright test e2e/expense-capture-intake.evidence.spec.ts --project=desktop-1440 --project=iphone13-chromium --workers=1
# old flows, unchanged suites, same stack:
corepack pnpm exec playwright test e2e/expenses.spec.ts e2e/receipt-draft-continuity.spec.ts e2e/reimbursement-receipt.spec.ts \
  e2e/substitute-editable-navigation.spec.ts e2e/expense-number-save.spec.ts e2e/expense-running-number.spec.ts \
  e2e/income-expense-ledger.spec.ts e2e/line-recovery.spec.ts --project=chromium --workers=1
corepack pnpm exec playwright test --project=chromium --grep @smoke --workers=1
```

Results of the runs that produced these pictures are in the "W09 verification" block of
[`docs/agent-memory/marketplace-buyer-expense-capture-2026-09-18.md`](../../../../agent-memory/marketplace-buyer-expense-capture-2026-09-18.md).
