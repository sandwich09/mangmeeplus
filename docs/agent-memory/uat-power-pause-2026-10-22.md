# Agent Memory: UAT power pause 2026-10-22

Status: COMPLETE — original Plan A pause `20261021T180137Z-0ccc30e3` completed once with
`UAT_POWER_PAUSED_WITH_DATABASE` in 336.241 seconds, exit 0.
Owner: platform; owner requested “ปิด uat ได้แล้ว”.
Scope: Gracefully stop retained UAT services, both original hosts, and original RDS through Plan A.

Decisions:
- Read the cloud operations and UAT/Production deployment runbooks before cloud access.
- Use only scoped profile `mangmee-kamal-uat`; its existing MFA session remains valid
  until `2026-10-22T00:30:40Z`. No new MFA challenge or alternative authority needed.
- Dispatched `python3 infra/kamal/power-uat pause` exactly once. Drain workers before API/AI,
  stop hosts before RDS, retain data/storage/Redis, then record durable paused intent.
- No application release, customer-gate change, data deletion or Production mutation.
  UAT/READY/PROD workflow run IDs: `NOT_DISPATCHED`; executable release/recovery runs: 0.
- Preserve the observed runtime as the next resume baseline. All three services now report
  source `733f77864a2ad333a781852fd95cf3c610f0a421`, superseding the previous resume's source.

Open questions: None for this power operation.

Artifacts:
- Private receipt: `.env.kamal/uat/runs/20261021T180137Z-0ccc30e3/result.json`.
- Resume baseline: `.env.kamal/uat/power-runtime.json`.
- Operation's cloud mutex owner was `power:20261021T180137Z-0ccc30e3`; local and cloud
  guards are absent after successful cleanup.

Verification:
- Preflight `power-uat status`: desired state active; API `i-0248e3a31d9b75ad1` and
  AI/workers `i-0ef193d594e475a65` running; RDS `watchdog-bms-uat-db` available.
- Local active guard absent before dispatch. Production read-only public health
  HTTP200/status ok and platform-access HTTP200/effectiveState OPEN passed before pause.
- Graceful workers/API/AI shutdown passed before host and database shutdown. Both owned
  SSM sessions terminated successfully; zero cleanup failures.
- Final independent `power-uat status`: desired state paused, both original EC2 hosts
  stopped, and original RDS stopped.
- Receipt runtime exactly equals `.env.kamal/uat/power-runtime.json`; all three services
  retain source `733f77864a2ad333a781852fd95cf3c610f0a421` for the next resume.
- Local active guard absent; shared cloud mutex read returned ParameterNotFound.
- Production public health HTTP200/status ok and platform-access HTTP200/OPEN passed
  after completion as well as before. No Production mutation or data deletion.
- `git diff --check` passed for this memory and the cloud operations runbook.

Next:
- Leave UAT paused until the owner requests reopening. The workstation is no longer
  needed for this completed operation.
- On a later start request, read the current runbook, ensure a valid scoped MFA session,
  and use Plan A `python3 infra/kamal/power-uat start` with the latest retained baseline.
