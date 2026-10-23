# Agent Memory: UAT cost Plan A

Status: COMPLETED — IMPLEMENTED_UAT_PAUSED_DATA_RETAINED; verified KMS-signed result.
Owner: primary agent.
Scope: UAT RDS pause/resume, guarded 30-minute AWS reconciliation, dedicated UAT ALB two-AZ mapping. No application release, resizing, deletion, gate change or Production mutation.
Decisions:
- Reuse local deployment.lock, active.json and strict SSM transport. Add a shared cloud mutex to the UAT release entry point and power operations so the scheduled reconciler cannot race a start/deploy. Failed/unknown operations retain their guard.
- Persist explicit active/paused intent; only an explicit successful pause enables automatic DB restopping. No idle-traffic inference. Retain DB/EBS/S3/Redis and original images/configuration.
- Current ALB is NOT a CloudFormation resource: it was recreated separately on October9. Change its exact ARN with SetSubnets, preserving the shared subnet resources and Production ALB. Record the observed two-subnet mapping as source of truth; do not import/recreate the ALB merely to change its mapping.
- Provision the small automation stack separately. Owner profile is infrastructure-bootstrap only; normal application releases remain non-root. UAT deploy role receives only the exact cloud guard permissions needed.
- UAT/READY/Production workflow IDs: NOT_DISPATCHED. This is infrastructure/power maintenance, not a new application release.
Open questions: none.
Artifacts: private evidence ~/.codex/uat-cost-plan-a-20261010/; plan docs/plans/uat-cost-reduction-plan-2026-10-10-th.md.
Verification: baseline had two UAT hosts stopped, four Production hosts running, Production health200/OPEN, DB available. Separate automation stack installed; dedicated UAT ALB changed in place to1a/1c and Production ALB readback unchanged. Cloud mutex reuses `/watchdog-bms/uat/redis-migration-lock`, including legacy workflow/Redis callers. Live Lambda invocation during power startup returned `operation_locked`. Controller tests38, release-path tests8, guard tests and supervisor drain checks pass.
Next: use `python3 infra/kamal/power-uat start` when UAT is needed, and `pause` after testing. Actual billing can be compared after sufficient usage accrues; no additional recurring assistant task was created.

## Final acceptance

- Final pause`20261010T151538Z-608a4f26` completed in451.418seconds. Both exact EC2 hosts stopped without public IPs; original RDS stopped; desired state paused; Redis available. Local active guard and shared cloud mutex are absent; owned transports cleaned.
- Production readback: all four original hosts running with unchanged topology/volumes, exact unchanged ALB, health200 and customerOPEN. UAT listener/TLS configuration unchanged; only its two-zone subnet mapping differs.
- Public [result](../evidence/uat-cost-plan-a-result-2026-10-10.json) matches the final private signed receipt`accepted-plan-a-v2.json`, SHA256`68aa91e1f04c4e2540c19ce2596ce9e2aecfaa49a594cd4fcd9e766b71e77596`. KMS verification passed. V2 clarifies that the first start's15.44second clock measures reconciliation only; the original signed receipt is retained. The complete cold-resume434.064second clock is unchanged.
- Estimated UAT74.308–79.308USD/month, saving20.90USD/~711THB at34THB/USD,20testhours/30apphours/40DBhours/730monthhours. Excludes AI/tax/labor; this is not an observed new monthly bill.
- Changes remain scoped to UAT infrastructure/power tooling and documentation. No Production mutation, application deploy, package.json edit, data deletion, commit or push.

## Completed live verification

- Pause`20261010T145514Z-90324cea`: original containers drained, both hosts stopped, DB stopped, desired state paused;553.147seconds.
- Cold resume`20261010T150546Z-7b745960`: DB available before hosts start; exact retained containers explicitly resumed with unchanged`unless-stopped` policy. Baseline image/source/config fingerprints match. API/DB, AI, workers/Redis/internal API, public health/login and customerOPEN all passed in434.064seconds. Both ALB targets healthy in the two-zone topology.
- Read-only database transaction returned269tables and124397rows after resume. No before/after SQL-row checksum is claimed; no operator SQL writes, migrations, delete or restore were performed.
- Exact S3 manifest matched all344versions and6delete markers. The existing API instance role performed ListObjectVersions; no new data permission or file mutation was needed. DB resource identity/engine/class/storage/encryption/endpoint, Redis node identity/config and both EBS volumes match baseline. Canonical UAT target bytes unchanged.
- Current signed application acceptance independently re-verified through KMS. Exact current accepted image/config/container IDs checked via the existing strict runtime validator. The historical verifier and one local helper-module-path error were retained as read-only diagnostics; no application redeploy or data repair occurred.
- Operator bootstrap session expired after provisioning; subsequent required operations use scoped non-root UAT/reader profiles and the existing API role. Optional fresh Lambda log inspection was unavailable to the reader; the earlier actual invocation already proved overlap rejection. No further IAM permission was added.
- Limits: no new real LINE conversation/OCR/payment/upload business transaction; unchanged signed runtime plus readiness/routing/storage checks cover this infrastructure change. No week-long wait for automatic RDS restart; guard branches tested, live overlap skipped, and IAM simulation confirms UAT StopDB allowed/Production denied. Actual monthly billing is not yet available.

## Reconciliation evidence

- Bootstrap stopped before SetSubnets because CLI timestamps were strings and SDK timestamps datetime objects. Fresh readback proved only representation differed. Continued the same retained operation with normalized timestamps; no duplicate stack execution or ALB mutation.
- First power start`20261010T145000Z-b553d4f1` started the original hosts once. Early API readiness returned the existing validator's ValueError; corrected read-only polling and reconciled the same operation, preserving its first failure and guards. API/DB/AI/workers/Redis/internal API and publicOPEN then passed; no repeated StartInstances or DB command.
- October9 restoration metadata was stale: current signed release is`20261010T051819Z-2efb43f7`, source`9d9473b55f30f31bd78720274c9d1d3cc94eb644`, accepted hours before this maintenance. All three observed container IDs match that receipt. An old-source verifier correctly failed read-only; its evidence is retained. Verify against the current accepted release, never roll back to the old restoration source.
- Both bootstrap SDK retry-config validation errors happened locally before any AWS request. The shared-mutex update change set included a conditional permission update through its unchanged Lambda ARN; final expanded resource review confirms only the isolated UAT automation stack was touched. No Production mutation.
