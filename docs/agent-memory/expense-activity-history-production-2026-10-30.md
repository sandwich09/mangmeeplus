# Agent Memory: expense activity history Production promotion — 2026-10-30

Status: COMPLETE — Production serves the exact UAT source/images, signed/verified and customer live/OPEN (2026-10-30 19:27 Bangkok).
Owner: Codex, user-authorized “เอาขึ้น prod เลย”.
Scope: Promote the exact accepted UAT image bundle to retained Kamal Production, with no rebuild.

Decisions:
- Candidate: `a02b9ccca8047caf951ff83dbc4f82e5bf3e062c`; UAT operation `20261030T113901Z-99a9da2f`, signed/verified `ACCEPTED_LINE_DEFERRED` at 11:43 UTC.
- UAT accepted receipt SHA-256: `082d4cae508d7fbab38087f8df2478b7dde186fa9f844472ce95fab1cdd6eb31`.
- Controller: main `0bd1a9625ef6721d417b49d87edc167dce50e0f1`, documentation-only successor of the candidate; functional controller hash unchanged (`da915391c7e6b0ed488add2e655631a44f43f866304caebcc9584faa3e8aa080`). Keep main/release work stable through acceptance.
- Read cloud operations, mandatory UAT/Production V2 protocol and Kamal instructions. Use `promote-prod --uat-release ... --production-browser-acceptance`; normal mode. No root deploy, image rebuild, customer-gate change or historical waiver reuse.
- Fresh MFA established scoped `mangmee-kamal-production` role session; MFA code is not persisted.
- `UAT_RUN_ID=NOT_DISPATCHED`, `READY_RUN_ID=NOT_DISPATCHED`, `PROD_RUN_ID=NOT_DISPATCHED`; local Kamal operation IDs are separate. Prior serving source is `8c112ea70003057fa3063938e859de1b945747d1`.

Open questions: None.

Current owner decisions:
- User explicitly authorized root `thawatchai` solely for pre/post `DescribeAlarms` in this release. Its expired console session was refreshed through owner login; deploy still uses the scoped non-root role. No credentials/verification codes are stored in this ledger or evidence.
- User explicitly instructed “alarm อันเก่าข้ามไปได้เลยนะ สนใจแค่ของรอบนี้”. Fresh baseline has 29 OK and one existing API-security Alarm, last transition/update 2026-10-09 07:54:12 UTC; this unchanged historical Alarm is accepted for this release. New/current-release alarms remain blockers. No Alarm is changed or suppressed.

Artifacts:
- [UAT evidence](expense-activity-history-uat-2026-10-30.md).
- Production preflight `20261030T120204Z-608b0ca4`: `PREFLIGHT_PASSED_NO_DEPLOYMENT`, 18.586 seconds, owned SSM cleanup 4/4.
- Promotion preparation `20261030T120335Z-bc2072d4`: `PREPARED_NO_DEPLOYMENT`, 48.532 seconds. Signed UAT receipt verified, exact four images and AgentCore artifact reused without rebuild, complete Production config/freshness and capacity passed on all four hosts; SSM cleanup 4/4.
- Apply `20261030T121827Z-e64994ae`: signed/verified `ACCEPTED_LINE_DEFERRED`, completed 12:27:07 UTC under the scoped Production deploy role. All 12 phases passed; no duplicate dispatch or rebuild.
- Apply command: 520.362 seconds total, including website-ready at 302.541 seconds and browser acceptance stage 190.892 seconds. Preparation and owner credential/login waits preceded this command and are not included in its total.
- Result SHA-256: `24ef7b1d98d93782d73e39ac7807dad6f54d1dac92ddfc6aa5fd46eb20c50686`.
- Accepted receipt SHA-256: `172c3abe1224ebdfd676d8c86255df9b511d3720a134bc007e92e33d9b246ff3`.
- Signature SHA-256: `572bef6a1e01c8cba8c468de1331f358a39068f8233e2542eadc25221dc58226`; KMS ECDSA SHA-256 verification passed. No ECS Passport/READY artifact was issued.
- Read-only proxy-status inspections `20261030T122102Z-3352af69` and `20261030T122543Z-cac1d623` used scoped SSM/SSH and each closed 2/2 owned sessions. They did not acquire a deployment lock or change runtime. Exact status evidence is copied into the accepted operation and hashed by its browser attestation.
- Private evidence belongs under canonical `.env.kamal/production/runs/<operation-id>/`; do not commit raw private runs or credentials.

Verification:
- Both origin/main and origin/develop equal the controller; no active GitHub flow found before preparation.
- Production enrollment exists; no unresolved local active guard. Target readiness preflight passed.
- Real in-app browser, owner login: `/api/v1/auth/me` identifies `cmt8k20fs00000q319isxwkc5`, SYSTEM_ADMIN, `system.launch_gate.manage`, `mustChangePassword=false`, `legalAcceptanceRequired=false`. `/api/v1/system/platform-access` has `effectiveState=OPEN`, `servingMode=live`, `canOpen=true`; existing gate reason retained. No gate write.
- Fresh pre-release Alarm snapshot retained privately at `.env.kamal/production/expense-history-20261030/alarms-before.private.json`; historical waiver above applies only to the observed old Alarm.
- Final runtime readback: both API/Web hosts, AI Gateway and Workers running with exact candidate source, exact UAT image IDs and complete config validation. Deep API/DB/AI/workers/Redis/internal-API readiness and migration/catalog/feature authority passed; retirement 19/19 passed.
- Current-release browser acceptance passed all ten checks. An expired access token first returned 401; the real application automatically refreshed the owner's session (HTTP 204), then exact administrator/permission/flags and live/canOpen/OPEN reads passed. No manual login retry, credential reset or session extraction.
- Actual proxy logs correlate GET `/api/v1/auth/me` and `/api/v1/system/platform-access` HTTP 200 with the unique release nonce; authenticated system page 200, UI logout POST 204 at 12:25:08 UTC, and post-logout `/me` 401 at 12:25:09 UTC. The browser returned to the login form. Owner's existing authenticated session was used; a new login POST response was not separately captured. Passwords/cookies were never extracted.
- Post-signature public health, platform access and login all returned 200, health `ok`, customer `OPEN` and the open marker. Final Alarm read: 29 OK and the same accepted 9 October API-security Alarm; no new/changed non-OK alarm. Final private snapshot SHA-256 `5990ba734492d47ab429fb1b0d55257c9443917ad0c614e29d3d22b850c40f03`.
- All four apply-owned SSM sessions terminated; local active guard absent and controller released its owned remote lock normally. No customer-gate/Alarm change. UI verification tabs closed, Production login retained for the user.
- Scope limits: no native LINE/LIFF, external-provider messaging, or authenticated expense editing journey was exercised. Feature browser/permission tests remain the previously recorded focused checks and fixtures.

Next: Production ready for use at https://mangmeeplus.com. Retain the private accepted UAT/Production bundles and original failure records for future recovery; the new release ledger is documentation-only and needs no redeploy.
