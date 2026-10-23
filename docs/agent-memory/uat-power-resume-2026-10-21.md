# Agent Memory: UAT power resume — 2026-10-21

Status: COMPLETED — UAT_RUNNING_OPEN; both hosts running, database available, public OPEN verified.
Owner: primary agent; user requested “เปิด uat”.
Scope: Resume retained UAT database and two application hosts through the Plan A controller, then verify current runtime, readiness and public OPEN.
Decisions:
- Read current cloud operations, mandatory deployment protocol and Plan A operating instructions before AWS access.
- Initial readback: intent paused; API `i-0248e3a31d9b75ad1`, AI/workers `i-0ef193d594e475a65` and original database `watchdog-bms-uat-db` stopped; local active guard absent.
- Execute `python3 infra/kamal/power-uat start` once using the default scoped non-root UAT profile. Preserve the latest pause baseline, source `1e25d673db5d3f19997176eeab8ea54533d1a57f`.
- Power operation ID: `20261021T022345Z-77d13f74`, following pause `20261020T173137Z-bc14ee85`.
- UAT_RUN_ID, READY_RUN_ID, PROD_RUN_ID: `NOT_DISPATCHED`. No deployment or customer-gate mutation.
Open questions: none.
Artifacts: private `.env.kamal/uat/runs/20261021T022345Z-77d13f74/result.json`.
Verification:
- `python3 infra/kamal/power-uat start` exited 0 with `UAT_RUNNING_OPEN` in 264.038 seconds. Database readiness preceded host startup; no retry or duplicate operation.
- Independent final `power-uat status`: intent active, both exact hosts running, original database available.
- All three container/image/environment/source/restart-policy fingerprints exactly match the latest pause baseline; source remains `1e25d673db5d3f19997176eeab8ea54533d1a57f`.
- Controller deep readiness passed API/DB, AI, workers/Redis/internal API. UAT public health, platform-access and login returned 200; customer state and login marker are OPEN.
- Both owned SSM sessions terminated with zero failures; local active guard and shared cloud mutex independently read back absent. No executable release/recovery workflow overlapped.
- Production public health 200/status ok and platform-access OPEN passed before and after resume. No Production mutation, deployment, data deletion or gate change.
- This power-operation receipt does not claim a new signed application release or new real LINE/OCR/payment/upload business journey; existing application acceptance remains unchanged.
Next: UAT is ready at https://uat.mangmeeplus.com. Use `python3 infra/kamal/power-uat pause` when the owner requests shutdown.
