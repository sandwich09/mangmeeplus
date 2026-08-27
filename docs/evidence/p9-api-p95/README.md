# P9-1c — Local API latency source and browser evidence

Date: 2026-08-27 (Asia/Bangkok). Branch: `codex/p9-observability-phase1c-api-p95`,
base `086a4549990c0a0c1312d23aba13f2ab662bf6ca` (OCR PR #280 merged).
Local web :3000 / API :3001 / PostgreSQL :15432 / Redis :6379; no cloud access.

## Actual Chrome checks

1. Existing System Admin session could view the OCR card; company ledger correctly denied access because
   System Admin has no company membership. Signed out through UI, then used the local seed OWNER sign-in.
2. Opened income-expense ledger, clicked “รอรับเงิน”; desktop table/mobile cards and outstanding explanation rendered.
3. Followed “ถ่ายหรืออัปโหลดใบเสร็จ”, typed an unsaved note and cleared it. No document/OCR/payment was created.
4. Checked 1440x1000 and 390x844: no horizontal overflow; primary ledger filter/payment buttons measure 44px.
5. Browser error/warning list was empty. Temporary viewport override reset after testing.

Screenshots (actual local UI, not mockups):

- `ledger-desktop.jpg` — summary and source/category context at 1440x1000.
- `ledger-mobile.jpg` — outstanding cards and 44px payment actions at 390x844.
- `receipt-upload-mobile.jpg` — receipt upload instructions/controls at 390x844.

The existing System Admin feature catalog showed fail-closed “ข้อมูลฟีเจอร์ไม่ครบ” on unrelated legacy feature
controls; no feature was toggled. This phase changes monitoring only and does not claim full P24 admin UX acceptance.

## Source and infrastructure checks

- Completed local ledger API reads returned HTTP 200 and emitted `msg=request` with numeric `durationMs`:
  entries 135ms, summary 143ms, filtered entries 56ms (individual dev observations, not a latency target).
- `bash -n infra/monitoring/runtime-alarms.sh infra/monitoring/runtime-alarms.spec.sh` — pass.
- `bash infra/monitoring/runtime-alarms.spec.sh` — pass, UAT/Production fake installation and read-back;
  rejects default sample, identity dimensions, system dimensions, system selection, transformed input,
  missing non-negative guard and Average-stat drift; accepts empty optional dimensions/metadata.
- Registered journey/request logger specs — 34/34 pass, 0 skipped; API build/typecheck, web typecheck,
  contracts/config builds and production config validation 48/48 pass.

These checks prove implementation/configuration and the local log source only. They do not prove deployed
CloudWatch metric data or alerts. Follow the separate post-install SampleCount/p95 and acknowledged-alert
gates in the runbook before claiming live coverage. No SLO, threshold or customer baseline was invented.
