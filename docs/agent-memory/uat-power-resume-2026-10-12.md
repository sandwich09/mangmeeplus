# Agent Memory: UAT power resume — 2026-10-12

Status: COMPLETED — UAT_RUNNING_OPEN; database and both hosts running, public OPEN verified.
Owner: primary agent; user requested “เปิด uat”.
Scope: Resume the retained UAT database and two application hosts with the Plan A controller, then verify readiness and public OPEN.
Decisions:
- Read cloud operations, deployment protocol and Plan A operating instructions before AWS access.
- Initial readback: desired state paused; API `i-0248e3a31d9b75ad1`, AI/workers `i-0ef193d594e475a65` and database `watchdog-bms-uat-db` stopped.
- Execute `python3 infra/kamal/power-uat start` once with the default scoped non-root profile; retain the exact operation on failure.
- Power operation ID: `20261012T085508Z-5950c4d7`.
- UAT_RUN_ID, READY_RUN_ID, PROD_RUN_ID: `NOT_DISPATCHED`. No application release or customer-gate mutation.
Open questions: none.
Artifacts: private `.env.kamal/uat/runs/20261012T085508Z-5950c4d7/result.json`.
Verification:
- `python3 infra/kamal/power-uat start` exited 0 with `UAT_RUNNING_OPEN` after 480.850 seconds. RDS startup included an automatic `backing-up` stage; the same operation waited until available before starting hosts.
- Final `power-uat status`: desired state active, both exact hosts running, database available.
- Exact retained container IDs, images, environment fingerprints, source and restart policies match the last successful pause. All three services retain source `9d9473b55f30f31bd78720274c9d1d3cc94eb644` from accepted release `20261010T051819Z-2efb43f7`.
- Controller deep readiness passed API/DB, AI, workers/Redis/internal API. Public UAT health, platform-access and login returned 200; customer state and login marker are OPEN.
- Both owned SSM sessions terminated; zero cleanup failures. Local active guard and shared cloud mutex independently read back absent.
- Production public health 200/status ok and platform-access OPEN passed before and after UAT startup. No Production mutation.
- This is a power resume with a controller receipt, not a new signed application release. Prior signed acceptance remains unchanged. No new real LINE/OCR/payment/upload business journey was exercised.
Next: UAT is ready for use at https://uat.mangmeeplus.com. Use the documented `power-uat pause` procedure when the owner requests shutdown.
