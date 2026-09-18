# Agent Memory: Production migration output preflight

Status: Consolidated offline rehearsal and actual AWS read audit passed; exact-head CI pending. No forward retry.
Owner: Codex; user authorized isolated hotfix, Kamal migration and scoped admin merge.
Scope: Keep application candidate 0b0058ad on prod baseline fc2838c4. Correct migration controller only.

Decisions:
- Production attempt 20260918T101611Z-1069a958 switched both owned rules, then CloudFormation output
  GetAtt failed on iam:GetRole. AWS restored traffic; explicit ECS recovery20260918T103003Z-7bfbc4ef
  now signed ROLLED_BACK_TO_ECS. No claim that traffic never switched.
- Fixed15output contract: exact enrolled hosts/IPs, VPC, ECR, deploy role, signing key and AgentCore.
  Read every output GetAtt provider before publication/worker handover and reject unknown providers.
  Native provider metadata permissions are audited separately using AWS registry schemas and actual
  nonroot calls. This guard is not a general CloudFormation emulator or a guarantee of AWS execution.
- IAMv5 keeps prior authority and expiry, adds only bounded provider reads; installed after signed recovery.
  No application/migration/tenant/permission/data changes and no package.json edits.
- Reused existing release controller and tests under ponytail full; no extra dependency or framework.

Open questions: None for this controller change. Live business receipt facts remain separate.
Artifacts:
- Prior forward:20260918T101611Z-1069a958; recovery:20260918T103003Z-7bfbc4ef.
- Recovery accepted SHA256:8bbfa19ce385cd96b34228789ad803bea93016b2dce9bb3e206051581b2f1c99.
- UAT comparison:20260917T141152Z-297dcbcc,279.406s, all11phases and fresh KMSVerify true;
  accepted SHA256:ddeeaaea03bdc52ae96cbb60ee35336454f2de83712ce3c9563ebd53a52581b9.
- UAT/READY/Production workflow IDs:NOT_DISPATCHED (local Kamal operation IDs above).
- Private actual provider schema/read/simulation evidence retained in sibling rehearsal checkout
  .env.kamal/rehearsal/stack-output-read-audit; no secrets committed.

Verification:
- Before correction:64tests completed,10expected failing subcases exposed absent output provider reads
  and unknown/drifted outputs. Remaining cutover/sign/enroll/rollback and negative boundaries ran.
- After correction:python3 -B -m unittest discover -s infra/kamal -p '*_test.py':64PASS,0.989s.
- Browser checks cover all10required flags and all7rollback binding fields; simulated evidence clearly labelled.
- Actual signed recovery:5phasesPASS957.756s, restore465.032s, acceptance454.240s including ownerwait.
  Owner-observed Chrome proof retained with explicit provenance; controller publicOPEN and ECSreadbacks passed.
- UAT smoke exception excludes login/logout and first-migrationCF; not substituted for Production acceptance.

- Actual nonroot IAMv5 audit:33checks passed (31success,2expected absent ECR policies); no AccessDenied.
  Conditional SSM association read was simulated only because no association exists; no fake live proof.
- Actual new output/traffic preflight passed against the retained Production stack and nonroot principal.
- Release pin check, pin-sync regression and git diff --check passed.

Next: Exact-head CI and reviewed merge; only then
one forward attempt with the unchanged prepared application build and complete actual acceptance.
