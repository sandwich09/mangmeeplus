# Agent Memory: UAT power pause — 2026-10-12

Status: COMPLETED — UAT_POWER_PAUSED_WITH_DATABASE; both hosts and original database stopped.
Owner: primary agent; user requested “ปิด uat ได้แล้ว”.
Scope: Gracefully stop retained UAT workers/API/AI, both application hosts and the original database through the Plan A power controller.
Decisions:
- Read current cloud operations, mandatory deployment protocol and Plan A operating instructions before AWS access.
- Initial readback: desired state active; API `i-0248e3a31d9b75ad1` and AI/workers `i-0ef193d594e475a65` running; database `watchdog-bms-uat-db` available; no local active guard.
- Execute `python3 infra/kamal/power-uat pause` once using the default scoped non-root profile. Retain the exact operation and guards on failure.
- Power operation ID: `20261012T102746Z-fe821dd6`.
- UAT_RUN_ID, READY_RUN_ID, PROD_RUN_ID: `NOT_DISPATCHED`. No deployment or customer-gate mutation; data and retained infrastructure remain.
Open questions: none.
Artifacts: private `.env.kamal/uat/runs/20261012T102746Z-fe821dd6/result.json`.
Verification:
- `python3 infra/kamal/power-uat pause` exited 0 with `UAT_POWER_PAUSED_WITH_DATABASE` in 428.073 seconds. Existing controller verified graceful worker/API/AI shutdown before stopping hosts, then waited for the original RDS database to stop.
- Independent final `power-uat status`: intent paused, both exact hosts stopped, database stopped.
- Both owned SSM sessions terminated with zero failures; local active guard and shared cloud mutex independently read back absent. No executable release/recovery workflow overlapped.
- Observed runtime exactly matches the newly saved `.env.kamal/uat/power-runtime.json` pause baseline. All three service sources are `de8389ce304dd96dcaba0104a2a09b8d609072fa`. Container/image/config fingerprints differ from the morning resume, reflecting the runtime already serving before this pause; this operation did not deploy or restore applications. Future resume must preserve this new baseline, not the morning source.
- Production public health 200/status ok and platform-access OPEN passed before pause and again after UAT application hosts stopped. No Production mutation, data deletion or gate change.
- Data/storage/Redis/ALB are retained under Plan A; this is a power pause, not resource retirement or zero-cost shutdown. No new application acceptance signature is claimed.
Next: leave UAT paused. When the owner requests reopening, use `python3 infra/kamal/power-uat start` and verify the retained current runtime and public OPEN.
