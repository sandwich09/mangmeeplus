# Agent Memory: UAT power pause — 2026-10-18

Status: COMPLETED — UAT_POWER_PAUSED_WITH_DATABASE; hosts/database stopped, paused intent and cleanup verified.
Owner: primary agent; user requested “ปิด uat ได้แล้ว”.
Scope: Gracefully stop retained UAT workers/API/AI, both application hosts and original database through the Plan A controller.
Decisions:
- Read current cloud operations, mandatory deployment protocol and Plan A operating instructions before AWS access.
- Initial readback: intent active; API `i-0248e3a31d9b75ad1` and AI/workers `i-0ef193d594e475a65` running; original database `watchdog-bms-uat-db` available; local active guard absent.
- Execute `python3 infra/kamal/power-uat pause` once using the default scoped non-root profile. Retain this operation and guards on failure.
- Power operation ID: `20261018T091319Z-f5484b30`.
- UAT_RUN_ID, READY_RUN_ID, PROD_RUN_ID: `NOT_DISPATCHED`. No deployment or customer-gate mutation; retain data and infrastructure.
Open questions: none.
Artifacts: private `.env.kamal/uat/runs/20261018T091319Z-f5484b30/result.json` and `pause-interim-state.json` in the same directory.
Verification:
- Initial `power-uat status` passed; Production health 200/status ok and platform-access OPEN verified before pause.
- Interim independent readback at 2026-10-18 16:18:15 Asia/Bangkok (09:18:15 UTC): both exact hosts stopped, database stopping, intent still active. The controller sets paused intent only after the database stops.
- Local active guard and cloud mutex still belong to `20261018T091319Z-f5484b30` / `power:20261018T091319Z-f5484b30`. This is expected while the original process is running, not evidence of completed cleanup.
- User asked whether they could shut down the workstation. Explained that the local controller still needs to record paused intent and release guards; user then requested saving available evidence while waiting. The interim snapshot is saved without modifying the controller's result.
- The interim snapshot above is historical; the same original operation subsequently completed successfully without interruption or retry.
- `python3 infra/kamal/power-uat pause` exited 0 with `UAT_POWER_PAUSED_WITH_DATABASE` in 426.474 seconds. Controller verified graceful worker/API/AI shutdown before stopping hosts, then waited for database shutdown.
- Independent final `power-uat status`: both exact hosts stopped, original database stopped, intent paused. Local active guard and shared cloud mutex independently read back absent.
- Both owned SSM sessions terminated with zero failures. No executable release/recovery workflow overlapped.
- Runtime fingerprints exactly match the newly saved pause baseline. All three sources are `ee0d65ccc93ab344e32d363ec48171f57c271809`, differing from the earlier resume's source because the serving runtime had changed before this pause. This operation did not deploy or restore an application. Preserve this new baseline for future resume.
- Production health 200/status ok and platform-access OPEN passed again after completion. No Production mutation, data deletion or customer-gate change.
- Data, Redis, ALB and storage remain retained under Plan A. This power-operation receipt does not claim a new application acceptance signature.
Next: leave UAT paused; workstation may be shut down. When the owner requests reopening, use `python3 infra/kamal/power-uat start` to resume the exact retained current runtime and verify public OPEN.
