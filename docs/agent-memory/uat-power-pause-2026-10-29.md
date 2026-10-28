# Agent Memory: UAT power pause 2026-10-29

Status: COMPLETE — retained UAT application hosts and database are stopped; Production remains healthy and `OPEN`.
Owner: Codex
Scope: Pause retained UAT after the latest-main UAT and Production release, preserving its data and exact runtime baseline for a later canonical start.
Decisions:
- Use the canonical retained-environment `power-uat pause` controller once with scoped non-root profile `mangmee-kamal-uat`; do not dispatch a release workflow or mutate the customer gate.
- Preserve the running source `8c112ea70003057fa3063938e859de1b945747d1` as the resume baseline for API/Web, AI Gateway and Workers.
- Stop services gracefully in Workers, API/Web, AI Gateway order, then stop both EC2 hosts and RDS. No data deletion or Production mutation is allowed.
Open questions:
- None. UAT should remain paused until the owner asks to start it again.
Artifacts:
- Private result: `.env.kamal/uat/runs/20261028T182046Z-2b8ad842/result.json` in the canonical primary checkout.
- Retained baseline: `.env.kamal/uat/power-runtime.json` in the canonical primary checkout.
- Result SHA-256: `f4e474c200317bbedfd088a0e6d6157d3107dd20b987663687eca61a087e3681`.
- Runtime-baseline SHA-256: `7b7a3ffb133cc90ca184d0101638ae0e4af36b57d1713e478497f55ead0828c4`.
Verification:
- Operation `20261028T182046Z-2b8ad842` completed `UAT_POWER_PAUSED_WITH_DATABASE` in 338.118 seconds.
- Before pause, desired state was `active`, both retained EC2 hosts were `running`, RDS was `available`, no local active operation existed, and Production health/customer gate were 200/`OPEN`.
- Runtime capture recorded API/Web, AI Gateway and Workers on exact source `8c112ea70003057fa3063938e859de1b945747d1`, all with restart policy `unless-stopped`.
- Final readback: desired state `paused`; EC2 `i-0248e3a31d9b75ad1` and `i-0ef193d594e475a65` both `stopped`; RDS `watchdog-bms-uat-db` `stopped`.
- Operation result records `productionMutated=false`, `dataDeletion=false`, zero executable release workflows and workflow ID `NOT_DISPATCHED`.
- Owned SSM cleanup passed with 2 terminated and 0 failed sessions. Local `active.json` is absent and the cloud mutex returns `ParameterNotFound`, proving both guards are clear.
- Public UAT `/v1/health` returns 504 while paused, as expected. Production `/api/v1/health` remains 200/`ok` and `/api/v1/auth/platform-access` remains 200/`OPEN` after the pause.
Next:
- Leave UAT paused. To resume, run the canonical `power-uat start` controller with the scoped UAT profile and require retained-runtime equality plus public `OPEN` readiness before use.
