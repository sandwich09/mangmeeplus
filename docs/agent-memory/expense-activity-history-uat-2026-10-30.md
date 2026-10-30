# Agent Memory: expense activity history UAT deployment — 2026-10-30

Status: COMPLETE — UAT serves the exact candidate, signed/verified and customer OPEN (2026-10-30 18:43 Bangkok).
Owner: Codex, user-authorized “deploy uat”.
Scope: UAT only, using the reviewed local Kamal controller and canonical shared enrollment/state.

Decisions:
- Candidate: `a02b9ccca8047caf951ff83dbc4f82e5bf3e062c`, latest origin/main and origin/develop at start. Includes expense history and the subsequently integrated new-shop LINE advisor.
- Controller: same main revision; manifest SHA-256 `da915391c7e6b0ed488add2e655631a44f43f866304caebcc9584faa3e8aa080`.
- Read cloud operations, UAT/Production V2 deployment protocol, and Kamal instructions. Use the documented UAT smoke acceptance path; LINE interaction and browser login/logout are not claimed.
- Scoped `mangmee-kamal-uat` assumed role verified. Reuse canonical `.env.kamal` via ignored symlink, including locks, config baseline, and retained evidence.
- Build/publish once with `--prepare --publish-images`, then apply that exact `build/` directory. No production operation or workflow dispatch.
- `UAT_RUN_ID=NOT_DISPATCHED`, `READY_RUN_ID=NOT_DISPATCHED`, `PROD_RUN_ID=NOT_DISPATCHED`; local operation IDs below are separate from workflow IDs.

Open questions: None.

Artifacts:
- Feature implementation/review evidence: [expense-activity-history.md](expense-activity-history.md).
- Read-only preflight: `20261030T112355Z-845c0feb`, `PREFLIGHT_PASSED_NO_DEPLOYMENT`.
- Preparation: `20261030T112603Z-3d7cab43`, `FAILED` at `host-storage-capacity` after 285.896 seconds. Build (all 11 phases) and complete config validation passed; nothing published or deployed; owned SSM cleanup passed 2/2.
- Read-only diagnosis: `20261030T113216Z-ee07a368`, complete with SSM cleanup 2/2. API host `i-0248e3a31d9b75ad1` had 3,551,330,304 bytes available against candidate requirement 5,079,329,968; peer host had ample capacity. Thirteen obsolete tools tags remain beyond the current and previous release.
- Bounded cleanup: `20261030T113402Z-e848087e`, `BOUNDED_TOOLS_CLEANUP_COMPLETE`. Removed exactly 13 old unused tools tags; kept current+previous tools and every container. Documented dangling-image prune reclaimed 0 additional bytes. Available space now 27,096,817,664 bytes; container IDs/images/states unchanged; SSM cleanup 2/2. Local guard and owned remote lock released after verification.
- Preparation retry: `20261030T113607Z-8daff7a6`, `PREPARED_NO_DEPLOYMENT`, 71.457 seconds; all six phases and SSM cleanup 2/2 passed. Reused build result SHA-256 `d884d0bcba75457113ef3137db1844df5f7854a502296c854522d97b68e45af5`, with identities revalidated; all four prepared images published.
- First apply: `20261030T113747Z-9e276b76`, `FAILED` in 13.905 seconds at prepared-source validation, before publication/provider/database/runtime changes. The retry preparation copied `build/` but did not create its sibling `source/`; the loader expects that checkout. Both owned SSM sessions terminated and operation guards were released normally.
- Root-cause proof: original and retry `build-result.json` are identical; original `20261030T112603Z-3d7cab43/source` exists, is clean and exactly the candidate; all four local image IDs/revision labels match the published preparation. Correct the apply input to the original build directory, preserving both failure records. No controller bypass, source copy, image rebuild, or lock deletion.
- Apply retry: `20261030T113901Z-99a9da2f`, signed/verified `ACCEPTED_LINE_DEFERRED`, 277.582 seconds; all 12 phases passed. Original prepared build identity revalidation passed in 0.372 seconds. This duration is the successful apply command only; it excludes preparation, diagnostics and both retained pre-mutation failures.
- Result SHA-256: `5775f35a0c302aae3d974115165ea6858fdf3e33258eb546bd946c21dd923811`.
- Accepted receipt SHA-256: `082d4cae508d7fbab38087f8df2478b7dde186fa9f844472ce95fab1cdd6eb31`.
- Signature SHA-256: `2a2aa4af91adf8f772eeda8639beb9409895470ecb99c6e8854c83cb60de8f36`; KMS ECDSA SHA-256 verification passed. No ECS Passport/READY artifacts were issued.
- Private release evidence is under canonical `.env.kamal/uat/runs/<operation-id>/`; do not commit resolved environments or raw run directories.

Verification:
- No active GitHub flow found in recent-run inspection before starting; local `active.json` absent and target preflight passed.
- Target had already resumed successfully under power operation `20261030T104659Z-feb847a2`, `UAT_RUNNING_OPEN`.
- Live readback confirms both EC2 hosts running and RDS available; cloud mutex `/watchdog-bms/uat/redis-migration-lock` absent.
- Historical feature checks and known unrelated fixture failures remain recorded in the feature memory. Current clean-source full TypeScript, DI metadata, AgentCore and all four image builds passed.
- Before retry, both remote branches still equal the candidate; no active GitHub flow found. Re-read mandatory release/retry protocol. Retry uses `--prepare --publish-images --prepared-build .env.kamal/uat/runs/20261030T112603Z-3d7cab43/build`; controller revalidates source tree, image identities, complete build evidence and fresh config.
- All three serving services have exact candidate source/image identity and complete environment validation; API/DB, AI Gateway, workers/Redis/internal API readiness passed. Migration/catalog/feature authority passed; retirement 19/19 passed.
- Customer acceptance verifies public platform access `OPEN` and login HTTP 200 with the open marker. Post-acceptance reads of `/api/v1/health`, `/api/v1/auth/platform-access`, and `/login` also passed (200, health `ok`, `OPEN`). A preliminary extra probe used the wrong `/api/health` path and received 403; corrected to the documented endpoint without a service/config change.
- Final owned SSM session cleanup passed 2/2; local active guard absent. The controller released its owned remote lock normally. No Production deployment or customer-gate change.
- Scope limit: UAT smoke acceptance, not an authenticated expense-history or native LINE journey. Feature browser/permission tests are the previously recorded local fixtures; login/logout is not required for this documented UAT path.

Next: UAT ready for user testing at https://uat.mangmeeplus.com. Any Production promotion requires a separate user request and the mandatory protocol, using this signed UAT bundle without rebuilding.
