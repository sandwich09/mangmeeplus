# Agent Memory: UAT power resume 2026-10-21, second request

Status: COMPLETE — `UAT_RUNNING_OPEN`; original Plan A operation `20261021T161821Z-b5a04f57`
completed once in 343.157 seconds with exit 0.
Owner: platform; owner requested “เปิด uat”.
Scope: Resume the exact retained UAT runtime and database through Plan A.

Decisions:
- Read the cloud operations and UAT/Production deployment runbooks before cloud access.
- Honor the October21 MFA requirement using only profile `mangmee-kamal-uat`.
  Owner MFA authentication succeeded; STS returned account `311414082667` and the
  scoped UAT session expires at `2026-10-21T17:17:58Z`. The code is not persisted here.
- Dispatched `python3 infra/kamal/power-uat start` exactly once. Active intent precedes
  RDS and host startup; database readiness preceded host startup.
- No application deployment, gate change, data deletion or Production mutation.
  UAT/READY/PROD workflow run IDs: `NOT_DISPATCHED`; executable release/recovery runs: 0.

Open questions: None for this power operation.

Artifacts:
- Previous completed pause: `20261021T044652Z-a3920c2b`, documented in
  [pause memory](uat-power-pause-2026-10-21-second.md).
- Retained baseline: `.env.kamal/uat/power-runtime.json`; documented source
  `29b1eab65fe852db0abcd7b2f69d45d64a1ae540` for API, AI and workers.
- Current private receipt: `.env.kamal/uat/runs/20261021T161821Z-b5a04f57/result.json`.
- Operation's cloud mutex owner was `power:20261021T161821Z-b5a04f57`; local and cloud
  guards are absent after successful cleanup.

Verification:
- At `2026-10-21T16:13Z`, the local UAT active guard was absent.
- Production public read-only probes: `/v1/health` HTTP200/status ok;
  `/api/v1/auth/platform-access` HTTP200/effectiveState OPEN.
- After MFA, fresh `power-uat status` returned paused intent, both original hosts stopped,
  and original RDS stopped. Local active guard was absent before dispatch.
- The saved baseline still has source `29b1eab65fe852db0abcd7b2f69d45d64a1ae540`
  for all three services. Final runtime exactly equals this baseline, including container,
  image, source, restart-policy and environment fingerprints.
- Final independent `power-uat status`: desired state active; API `i-0248e3a31d9b75ad1`
  and AI/workers `i-0ef193d594e475a65` running; RDS `watchdog-bms-uat-db` available.
- API/DB, AI and workers/Redis/internal-API readiness all passed. Public health,
  platform-access and login returned HTTP200; customer state and login marker are OPEN.
- Both owned SSM sessions terminated successfully; zero cleanup failures. Local active
  guard absent; SSM shared mutex read returned ParameterNotFound.
- Production public health HTTP200/status ok and platform-access HTTP200/OPEN passed
  after completion as well as before. No Production mutation.
- `git diff --check` passed for this memory and the cloud operations runbook.
- This is retained-runtime power-on evidence, not a new signed application release.
  No new login/logout, LINE, OCR, upload, payment or other business journey was performed.

Next:
- UAT is ready at `https://uat.mangmeeplus.com`.
- Leave running for the owner. On a later stop request, use Plan A `power-uat pause`
  after checking the current runbook and scoped MFA session.
