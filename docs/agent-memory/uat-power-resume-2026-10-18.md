# Agent Memory: UAT power resume — 2026-10-18

Status: COMPLETED — UAT_RUNNING_OPEN; both hosts running, database available, public OPEN verified.
Owner: primary agent; user requested “เปิด uat”.
Scope: Resume retained UAT database and two application hosts through the Plan A controller, then verify current runtime, readiness and public OPEN.
Decisions:
- Read current cloud operations, mandatory deployment protocol and Plan A operating instructions before AWS access.
- Initial readback: desired state paused; API `i-0248e3a31d9b75ad1`, AI/workers `i-0ef193d594e475a65` and original database `watchdog-bms-uat-db` stopped. No local active guard.
- Execute `python3 infra/kamal/power-uat start` once using the default scoped non-root UAT profile; preserve the current October12 pause baseline.
- Power operation ID: `20261018T083826Z-a125e134`.
- UAT_RUN_ID, READY_RUN_ID, PROD_RUN_ID: `NOT_DISPATCHED`. No application release or customer-gate mutation.
Open questions: none.
Artifacts: private `.env.kamal/uat/runs/20261018T083826Z-a125e134/result.json`.
Verification:
- `python3 infra/kamal/power-uat start` exited 0 with `UAT_RUNNING_OPEN` in 597.466 seconds. RDS passed through starting/backing-up before becoming available; hosts started only after database readiness.
- Independent final `power-uat status`: intent active, both exact hosts running, original database available.
- All three retained container/image/environment/source/restart-policy fingerprints exactly match the October12 pause baseline; source remains `de8389ce304dd96dcaba0104a2a09b8d609072fa`.
- Controller deep readiness passed API/DB, AI, workers/Redis/internal API. UAT public health, platform-access and login returned 200; customer state and login marker are OPEN.
- Both owned SSM sessions terminated with zero failures; local active guard and shared cloud mutex independently read back absent. Controller found zero executable release/recovery workflows.
- Production public health 200/status ok and platform-access OPEN passed before and after resume. No Production mutation, deployment, data deletion or gate change.
- This power-operation receipt does not claim a new signed application release or new real LINE/OCR/payment/upload business journey. Existing application acceptance remains unchanged.
Next: UAT is ready at https://uat.mangmeeplus.com. Use `python3 infra/kamal/power-uat pause` when the owner requests shutdown.
