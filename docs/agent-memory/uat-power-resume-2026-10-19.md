# Agent Memory: UAT power resume — 2026-10-19

Status: COMPLETED — UAT_RUNNING_OPEN; both hosts running, database available, public OPEN verified.
Owner: primary agent; user requested “เปิด uat”.
Scope: Resume retained UAT database and two application hosts through the Plan A controller, then verify current runtime, readiness and public OPEN.
Decisions:
- Read current cloud operations, mandatory deployment protocol and Plan A operating instructions before AWS access.
- Initial readback: intent paused; API `i-0248e3a31d9b75ad1`, AI/workers `i-0ef193d594e475a65` and original database `watchdog-bms-uat-db` stopped; local active guard absent.
- Execute `python3 infra/kamal/power-uat start` once using the default scoped non-root UAT profile. Preserve the October18 pause baseline, source `ee0d65ccc93ab344e32d363ec48171f57c271809`.
- Power operation ID: `20261019T044422Z-5614625c`.
- UAT_RUN_ID, READY_RUN_ID, PROD_RUN_ID: `NOT_DISPATCHED`. No deployment or customer-gate mutation.
Open questions: none.
Artifacts: private `.env.kamal/uat/runs/20261019T044422Z-5614625c/result.json`.
Verification:
- `python3 infra/kamal/power-uat start` exited 0 with `UAT_RUNNING_OPEN` in 387.455 seconds. Database readiness preceded host startup; no retry or duplicate operation.
- Independent final `power-uat status`: intent active, both exact hosts running, original database available.
- All three container/image/environment/source/restart-policy fingerprints exactly match the October18 pause baseline; source remains `ee0d65ccc93ab344e32d363ec48171f57c271809`.
- Controller deep readiness passed API/DB, AI, workers/Redis/internal API. UAT public health, platform-access and login returned 200; customer state and login marker are OPEN.
- Both owned SSM sessions terminated with zero failures; local active guard and shared cloud mutex independently read back absent. No executable release/recovery workflow overlapped.
- Production public health 200/status ok and platform-access OPEN passed before and after resume. No Production mutation, deployment, data deletion or gate change.
- This power-operation receipt does not claim a new signed application release or new real LINE/OCR/payment/upload business journey; existing application acceptance remains unchanged.
Next: UAT is ready at https://uat.mangmeeplus.com. Use `python3 infra/kamal/power-uat pause` when the owner requests shutdown.
