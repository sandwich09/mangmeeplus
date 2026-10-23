# Agent Memory: UAT power pause — 2026-10-20, second operation

Status: COMPLETED — UAT_POWER_PAUSED_WITH_DATABASE; hosts/database stopped, paused intent and cleanup verified.
Owner: primary agent; user requested “ปิด uat ได้แล้ว” after the October20 afternoon resume.
Scope: Gracefully stop retained UAT workers/API/AI, both application hosts and original database through the Plan A controller.
Decisions:
- Read current cloud operations, mandatory deployment protocol and Plan A operating instructions before AWS access.
- Initial readback: intent active; API `i-0248e3a31d9b75ad1` and AI/workers `i-0ef193d594e475a65` running; original database `watchdog-bms-uat-db` available; local active guard absent.
- Execute `python3 infra/kamal/power-uat pause` once using the default scoped non-root profile. Retain this exact operation and guards on failure.
- Power operation ID: `20261020T103122Z-f350d84f`. This is a newly requested pause after resume `20261020T075416Z-a832c5b2`, not a retry of the morning pause.
- UAT_RUN_ID, READY_RUN_ID, PROD_RUN_ID: `NOT_DISPATCHED`. No deployment or customer-gate mutation; retain data and infrastructure.
Open questions: none.
Artifacts: private `.env.kamal/uat/runs/20261020T103122Z-f350d84f/result.json` and `pause-interim-state.json` in the same directory.
Verification:
- Initial `power-uat status` passed; Production public health 200/status ok and platform-access OPEN verified before pause.
- Independent interim readback at 2026-10-20 17:34:13 Asia/Bangkok: both exact hosts stopped, original database stopping, intent active. Local active guard and cloud mutex still belong to this original operation; final database shutdown, paused intent and cleanup remain pending.
- The interim snapshot is historical and superseded by final completion. The original pause command exited 0 with `UAT_POWER_PAUSED_WITH_DATABASE` in 567.907 seconds; no retry or duplicate pause.
- Controller verified graceful workers/API/AI shutdown before stopping hosts, then waited for original database shutdown. Independent final `power-uat status`: both exact hosts stopped, original database stopped, intent paused.
- Both owned SSM sessions terminated with zero failures; local active guard and shared cloud mutex independently read back absent. No executable release/recovery workflow overlapped.
- Runtime fingerprints exactly match the newly saved pause baseline. All three sources are `1e25d673db5d3f19997176eeab8ea54533d1a57f`, differing from the afternoon resume because the serving runtime had changed before this pause. This operation did not deploy or restore an application. Preserve this new baseline for future resume.
- Production public health 200/status ok and platform-access OPEN passed again after completion. No Production mutation, data deletion or customer-gate change.
- Optional read-only `rds describe-events` diagnostic was denied by the scoped profile's permissions while waiting. No permission was added and no retry was needed; the original controller subsequently completed and independent final state passed.
- Data, Redis, ALB and storage remain retained under Plan A. This is a power pause, not resource retirement; no new application acceptance signature is claimed.
Next: leave UAT paused. This operation no longer requires the workstation. When the owner requests reopening, use `python3 infra/kamal/power-uat start` to resume the exact retained current runtime and verify public OPEN.
