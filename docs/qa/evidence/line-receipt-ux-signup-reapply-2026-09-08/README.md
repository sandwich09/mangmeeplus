# Receipt UX and rejected reapplication evidence

Local API-served LIFF browser acceptance: 7/7 PASS at 390px and 1280px. Screenshots below are synthetic LINE identity/status fixtures using the actual page, script and CSP; they do not claim a real LINE account was provisioned. PostgreSQL tests separately verify rejected history with changed email, actual manual approval, idempotency and support persistence.

- `rejected-reapply-false-390.png`: rejected applicant without a current shop.
- `rejected-reapply-true-390.png`: rejected applicant retains existing shop entry alongside reapplication.

Receipt fixtures in `process-line-webhook.use-case.spec.ts` prove PANDA MALA printed total300, hidden internal IDs and a neutral web action, plus complete fallback text beyond400 characters. `expense-source-draft.logic.spec.ts` proves the nested reconciliation contract for quantity0.63, total243.75 and persisted unit386.9048. This is application/provider-payload evidence; real LINE device rendering remains a UAT customer check.

See the task memory for exact test commands/results and the subsequent UAT run, digest and acceptance ledger. Production remains on hold.

## Deployed UAT evidence

UAT run `34153596271` SUCCESS, candidate `fe584d2f6006f251bebac0377e9ce7c4ac0c7588`. Signed Passport and canonical validator PASS; content SHA-256 `950d7a278dcad46906c1595fc9d2b7f21249b2ac9c7ef2be241b8b7794fc312f`. Artifact `10030748649`, archive digest `sha256:f18d36a461a4ca62faa12156cd4199ca8eac8e5434662ae6f9e76b6e15421eaa`.

- `uat-rejected-false-390.png`, `uat-rejected-true-390.png`: actual UAT-served page/script/CSP, with synthetic LINE identity and intercepted signup/support responses; no real request or notification. Corresponding acceptance JSON records both passes.
- `uat-public-login-390.png` and `uat-public-browser.json`: real public UAT hostname in fresh Chromium, no mocks. Login HTTP 200, customer gate OPEN, unauthenticated identity HTTP 401.
- `uat-runtime-acceptance.json`: three exact signed image/source matches, one running task per service, capacity 1/2, deep DB healthy, feature switches confirmed.
- `line-message-validation.json`: LINE validation endpoint HTTP 200 for four synthetic card variants. No recipient/outbound message. This confirms provider schema acceptance, not a native LINE device screenshot.

The first temporary hosted smoke token had two segments and was refused by the existing token-format guard; the correctly shaped synthetic token passes. Python urllib was blocked by the public edge (403/1010); the canonical curl check and real browser both passed without edge changes. These are test-client findings, not hidden UAT product fixes.

Automatic READY run `34155321390` also succeeded with all checks PASS, two migrations rehearsed, and signed cleanup `residualResourceCount=0`. The exact RDS clone and snapshot are absent. The run requested `maintenance_closed` only; no Production deployment occurred. `release-summary.json` records the artifact IDs/digests and final state. Main remains frozen at controller `d2e60091dad7434ba7476ea31b1121204ee7b047`; these final documentation updates are integrated through develop.
