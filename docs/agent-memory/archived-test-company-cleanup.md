# Agent Memory: archived-test-company-cleanup

Status: local/UAT and the authorized Production 28-company cleanup completed. Production OPEN;
original four application containers/images resumed after 19m22s maintenance. Frozen preservation
proof: all346,400 retained rows across257tables identical. Post-audit found one unassigned global
SalesEventTicket belonging to a deleted LINE identity; owner then authorized deleting this coupon.
The separate one-row follow-up completed2026-10-05 01:12Asia/Bangkok; other7coupons, lifetime
issuedCount and issuance audit preserved. Current result supersedes historical HOLDs below.
The three-hour scoped cleanup role remains; temporary root bootstrap authority was retired earlier.
Owner: Codex / user.
Scope: one Production/UAT operator cleanup script for archived early test companies, members,
signup and LINE history. Actual local, UAT and Production execution authorized and completed;
the newly discovered global coupon was handled by a separate explicit one-row authorization.
Decisions: explicit company IDs and ARCHIVED recheck, preview before apply, protect system/shared
users, preserve immutable evidence and report it. Existing user changes remain untouched.
Open questions: none for this coupon. User approved “ลบได้เลย” after identifying shop อินทิรา;
separate fresh review/backup and guarded transaction deleted it without downtime.
Shared user/LINE preserved. Other stores/providers/backups are explicitly outside erasure.
Artifacts: docs/specs/archived-test-company-cleanup-spec.md;
docs/plans/archived-test-company-cleanup-plan.md; docs/runbooks/archived-test-company-cleanup.md;
apps/api/src/scripts/cleanup-archived-companies.ts; cleanup-archived-company-stores.ts;
cleanup-archived-companies.pg.spec.ts; cleanup-archived-local-files.ts and .spec.ts (same directory).
Verification: latest PostgreSQL18.3/244migrations+MinIO/Redis regression15/15PASS,0skip and API
typecheck pass.19 allowed/7 denied IAM simulations, actual3h AssumeRole and19 S3-version reads pass.
Initial verification below predates hardening: PostgreSQL 16 local container, all 244 real migrations applied. Node test 10 PASS,
0 FAIL, 0 SKIP with local MinIO/Redis. Actual CLI prod/uat labels used only against local fixture
DB/stores; exact-version cleanup, unrelated data preservation and permission-failure resume pass.
Initial unrestricted tsc hit its default 4 GB heap cap; rerun with the repo's 8 GB setting passed.
Final `NODE_OPTIONS=--max-old-space-size=8192 pnpm --dir apps/api exec tsc --noEmit --pretty false`
also passed after all code/test changes. git diff --check and CLI --help passed. No package.json edited.
All three task-owned disposable containers/anonymous volumes were removed and absence verified.
Next: owned execution tools retired; recovery evidence retained. Approved live cleanup complete.
Do not rerun the completed DB apply. Resolve the SalesEventTicket soft-reference scope before
reusing this script for another cleanup; real email/LINE signup acceptance remains untested.


## Existing local database execution — 2026-10-04

User explicitly asked to run against the one existing ARCHIVED shop. Verified the running API
and worker use `ownercheck_dev` at `127.0.0.1:15900`, Redis `127.0.0.1:16900`, and MinIO
`127.0.0.1:19900` / `ownercheck-bucket`. Root `.env` points at different, inactive ports and was
not loaded. Added `--env local` as a label only; identical cleanup code and protections apply.

Target: `exa-c10` / ร้านกาแฟริมทาง, status ARCHIVED (legacy archivedAt is null).
Paused API/worker/web process trees (18 processes); checked no active DB writers/transactions.
Full custom-format pg_dump (1,754,291 bytes) restored successfully to a temporary database;
verified all 28 companies and target status, then dropped only that verification database.
Backup SHA256: `cf085273c977bec6b5776fe93e9a3f8272ce855996f0be48420313ca750a455d`.

Reviewed preview: 19 rows in 14 tables, one company/membership/private user; no shared users,
LINE IDs, S3 versions, Redis keys, BullMQ jobs or retained evidence in this target's inventory.
This local row therefore does not exercise LINE-history deletion; the disposable integration
suite above covers it. No external billing/provider operation or browser signup was performed.

CLI apply with matching manifest digest, `--writers-stopped`, and verified backup reference
returned `COMPLETED_WITH_RETAINED_EVIDENCE` at 2026-10-04T12:06:44.871Z, retained `{}`.
Compared per-table row hashes across all 266 application tables against the expected state
(before minus exactly the planned primary keys): all 12,881 unrelated rows unchanged.
After: 27 companies (23 ACTIVE, 1 SUSPENDED, 3 DISABLED), zero ARCHIVED companies.
All 18 processes resumed; API `/v1/health`, worker `/health`, and web returned HTTP 200.
Local/prod/uat argument checks, rejection of staging, CLI --help, and git diff --check passed.

Private backup, manifests, receipt and verification files:
`/Users/thawatchai/.codex/cleanup-backups/20261004-ownercheck-exa-c10/`
- `ownercheck_dev.before.dump` — full recovery backup, permissions 0600.
- `backup-verification.json` — size/hash and successful restore evidence.
- `preview-final.json` / `preview-final.json.result.json` — reviewed inventory and completion.
- `expected-after.json`, `verification-before.json`, `verification-after.json` — row-hash proof.
- `paused-processes.json`, `resumed-processes.json`, `services-after.json` — service recovery.
The directory is private (0700); no credentials were written into these artifacts or the repo.
Existing user containers/volumes remain running and unchanged apart from the scoped cleanup.


## UAT follow-up — 2026-10-04

User: “ทดสอบ บน uat ได้” authorizes UAT cleanup using the same ARCHIVED selection and
shared/protected-user boundaries. Read cloud operations and mandatory release/gate protocol.
UAT/READY/Production workflow run IDs: NOT_DISPATCHED (operator cleanup, no release).
Verified non-root `mangmee-kamal-uat-deploy` in account 311414082667 and both enrolled hosts
running in vpc-061922f7174f90a70 at 10.92.0.10 / 10.92.0.42. No local active release marker.
Next: strict-host-key SSM inspection and read-only ARCHIVED preview before any maintenance/apply.

Read-only UAT inventory: 73 companies (19 ACTIVE, 10 DISABLED, 44 ARCHIVED).
Serving source `7b1b1c11ee7ada750caa84bcd01e60b6ff1cde19`, container operation label
`20260930T083847Z-867eb170`; this is an existing release, not a newly dispatched run.
DB plan: 44,966 rows / 21 private users / 1 kept user / 1 LINE ID, retained legal records 22.
Guard correctly blocks `cms4t8phj00051n5qw3atytaj` (M14 UAT Security Evidence) because it
contains a protected/SYSTEM_ADMIN membership. Excluded that company; inspecting the other 43.
No DB delete, service pause, IAM change, gate change or provider mutation has occurred.

Read-only transport adjustments: runtime package root is `/app/api-runtime/apps/api`;
initial package-resolution probes failed without DB mutation and all owned sessions closed.
Local operator filename was changed to avoid Python's stdlib `inspect` name. The pg version
requires `uselibpqcompat=true&sslmode=require` for the existing runbook's TLS-over-SSM tunnel
behavior; confirmed against installed pg-connection-string code before another read-only preview.
Scoped deploy role lacks bucket-versioning reads; use the existing UAT API runtime authority
for application-store inventory, never modify IAM. Keys remain only in process memory.
Python's default user-agent receives Cloudflare1010; ordinary browser user-agent returns HTTP200
for health/login and PlatformAccess OPEN, with open page marker. No Cloudflare rule was changed.
Private UAT operation artifacts: `/Users/thawatchai/.codex/cleanup-backups/20261004-uat-archived/`.


UAT full preview passed for 43 companies after excluding protected M14 company: 21 private users,
40,350 rows, 64 S3 versions, 0 Redis keys/jobs, 22 retained legal records. A workstation preview
hit its 300-second read-only timeout; all owned tunnels/children closed. The same script was
packaged with the existing BullMQ dependency (no new dependency/image/deploy) and runtime preview
finished inside the API container. The registered running API image remains unchanged.

Existing authority is split: UAT API role reads inventory/retention; existing AI/worker role can
DeleteObjectVersion only on evidence/report/generated-substitute prefixes. Added optional separate
S3_DELETE_* credentials to the deletion client, keeping all reads on the original authority.
No IAM change. Owner profile identifies as AWS root and was not used for resource operations.
A nonexistent-version permission probe cannot certify this split: S3 returns ListBucketVersions
AccessDenied to the delete-only role for an absent version. No existing version was deleted.
Two newly created operator probe objects, one per required prefix, were then created/read by API
and exactly deleted by the worker authority; both prefixes passed and probe residue is zero.

Disposable PostgreSQL18/MinIO/Redis regression exposed RESTRICT SQLSTATE23001 in addition to
23503; child-first retry now handles both while keeping all constraints/transactions intact.
10/10 tests pass, no skips, including wrong separate deletion credentials (no fallback), recovery,
and skipping already-deleted S3 versions after a later Redis failure. Final API typecheck with the 8 GB heap setting passed after
the retry-case extension. No package.json edited.

Attempt12 stopped UAT writers, created a frozen preview, detected stale pre-maintenance evidence
(BillingAccount row hashes changed; WorkflowRun 995 -> 996), and aborted before backup/apply.
All original containers were restarted and the owned release lock removed. No DB rows or existing
S3 objects were deleted. Attempt13 now keeps writers stopped from the fresh frozen preview through
backup, explicit operator manifest review and apply; source/tenant/private-user scope must match.
Each attempt uses separate retained evidence, with workflow IDs still NOT_DISPATCHED.


Attempt13's workstation pg_dump timed out before apply. Its partial dump is invalid and retained
as failure evidence only. Original API/AI/workers restarted and owned lock/sessions closed.
Attempt14 moved pg_dump beside RDS using the immutable official PostgreSQL18 client image
`postgres@sha256:54451ecb8ab38c24c3ec123f2fd501303a3a1856a5c66e98cecf2460d5e1e9d7`,
TLS verify-full and existing application credentials in process memory. Full 18,087,150-byte
preflight backup transferred via strict SSM/SSH; hash matched and local full restore passed
with 73 companies (19 ACTIVE, 10 DISABLED, 44 ARCHIVED). No database deletion in these attempts.
Attempt15 uses the proven server-side backup path and a new frozen preview; backups, full restore,
S3 version backup and whole-database preservation snapshot must pass before its apply.


### UAT committed outcome — 2026-10-04 14:34:42 UTC

Operation `archived-cleanup-20261004-uat-15`; frozen manifest digest
`d3cfe2ba88c303d106dc884918b4b49a3503be2e3e6efad7e51195436ac37ff5`.
The single apply returned `COMPLETED_WITH_RETAINED_EVIDENCE` (started14:31:58.343Z,
completed14:34:42.560Z). Deleted43 ARCHIVED companies,21 private users/memberships,
40,352 total DB rows,64 exact S3 versions. Included1 ExternalIdentity,41 LINE webhook logs,
28 employee LINE link tokens,77 auth sessions and21 credentials. No target Redis keys/jobs.
Retained22 immutable LegalDocumentActionRecord rows and the protected M14 company.

Full frozen DB backup18,087,205bytes, SHA256
`d1b0bd6c0950bb09b6ca545fc4fb5bdd9614c264a78eb4243b6d1109da139c7a`.
Restored locally and every selected row/schema hash matched. Rehearsed actual DB cleanup against
that restored copy before live apply; the30 expected remaining companies matched. Backed up
all64 S3 versions (49,894,313 uncompressed bytes); verified each downloaded object's size/hash.
Both full restore and rehearsal operated only on the disposable local PostgreSQL18 fixture.

Before/after row-hash comparison across all257 public application tables passed:116,529 preserved
rows unchanged,0 incidental SET NULL changes. Remaining companies:19 ACTIVE,10 DISABLED,
1 ARCHIVED (protected M14). Exact S3 version and company-prefix residue checks passed in CLI.
Original API/AI/workers containers restarted and owned release lock released. No deployment,
gate/IAM change, provider-message send, or Production operation occurred.

Authoritative private artifacts are in
`/Users/thawatchai/.codex/cleanup-backups/20261004-uat-archived/execution-15/`:
- `watchdog_bms.uat.before.dump`, `database-backup-proof.json`, `database-rehearsal.json`.
- `object-backup.tar.gz`, `object-backup-proof.json`, `provenance.json`.
- `preview-final.json`, `operator-reviewed.json`, `preview-final.json.result.json`.
- `expected-after.json`, `verification-before.json`, `verification-after.json`.
- `stopped-services.json`, `restarted-services.json`.
Earlier failed-attempt artifacts remain separate and are not recovery backups or completion proof.


UAT acceptance14:35:45UTC passed using unchanged original container/image IDs: API/DB readiness,
AI health, workers/Redis/internal API, public health200, PlatformAccess OPEN and login200 with
open marker. `acceptance.json` records all checks and explicitly says browser signup not tested.
No provider email/LINE messages were sent. Deployment workflow IDs remain NOT_DISPATCHED.


Retirement passed: removed the3 task-owned remote staging directories and temporary files inside
API container;0 remaining operator/backup containers. The3 disposable local PostgreSQL/Redis/MinIO
containers and their anonymous volumes were removed; absence verified. All owned SSM sessions
closed successfully, including2/2 for apply, progress readback, acceptance and retirement.
Private backup/manifests/receipts remain on the workstation with directories0700 and files0600.
Final git diff --check passed. User's other code/docs changes were preserved; no package.json edits,
commit, push or PR occurred.


## Post-cleanup impact audit — 2026-10-04 21:49 Asia/Bangkok

User requested an impact check. Read-only UAT inspection plus an isolated local restore of the
verified pre-cleanup dump; no further live data mutation, service restart, gate change or messages.
Verified source behavior against the exact serving commit7b1b1c11ee7ada750caa84bcd01e60b6ff1cde19,
not just newer working-tree code. Runtime images unchanged; all3 services running,0 restarts/OOM.

**Actionable finding:** the operator restarted workers immediately after `docker start` of API/AI,
without waiting for readiness first. Recurring jobs reached API during startup. Redis evidence
contains42 dead-letter records covering28 recurring job kinds/17 queues, failed21:35:20.916–
21:35:33.139 Bangkok (14:35:20.916–14:35:33.139Z). The first log query started21:35:30, so its
44 error-like log lines covered only the last3 seconds; full queue evidence establishes the wider
13-second interval. These are recurring scan/drain/sweep jobs, not individual customer payloads.
All28 affected kinds subsequently completed after API readiness, verified per kind. No target-shop
job/cache residue. Keep the42 DLQ records as evidence; no manual replay/deletion was performed.
Future maintenance must wait for API/DB and AI readiness before restarting workers, then verify
worker Redis/internal-API readiness. The cleanup runbook now states this explicitly.

Data proof:257 tables rechecked;251 still byte-equivalent by sorted SQL row hashes after reopen.
579 reference fields across tables contained selected IDs only in the22 intentionally retained
legal rows. All392 FK constraints validated;0 FK orphan rows;0 soft-reference orphans in tested
signup/LINE/billing relationships. Remaining30 companies (19ACTIVE,10DISABLED,1ARCHIVED),37 users,
54 memberships,36 credentials,9 external identities unchanged;2 SYSTEM_ADMIN users/memberships.

The6 changed tables were investigated against a fresh local restore, down to changed columns:
- AuditLog:1 new successful `auth.session.refresh` event at21:36:07 Bangkok.
- AuthSession:1 existing ACTIVE session rotated tokenId/previousTokenId/rotatedAt/updatedAt;
  no account/session row was removed and no status/revocation changed.
- BillingAccount:11 existing rows changed scheduling/observation timestamps and reconciliation
  version only. All11 remaining accounts have livemode=false.
- BillingInvoice:19 existing rows changed financialObservedAt/updatedAt only; financial amounts,
  provider/apply states and ownership unchanged.
- BillingIssue:2 existing issues only refreshed lastSeenAt/updatedAt. Their RECONCILIATION_FAILED
  and PAID_NOT_APPLIED states already existed in the September17 baseline rows.
- FeatureLaunchObservationBucket:6 counters/updatedAt changed as scheduled observers resumed.
No unexpected preserved row deletion in those6 tables. This distinguishes normal live writes
from the exact frozen before/after preservation proof of116,529 rows at cleanup time.

Storage: bucket inventory358 versions/markers;0 deleted-version residue and0 selected-prefix
residue. All305 remaining ACTIVE S3 attachment references resolve. No remaining attachment
locator overlaps any deleted key or selected prefix. The17 missing attachment references were
already QUARANTINED in the baseline; no target overlap. One missing report file was already expired
on2026-08-10 in the baseline and is outside deleted keys; exact serving report code returns410 for
expired exports. There was no pre-cleanup bucket-wide existence snapshot, so historical physical
availability of these18 non-active/expired items is not asserted. DB attachment and report rows
remain hash-identical. One ACTIVE DB-backed attachment also remains unchanged.

Auth/signup behavior: exact serving AuthGuard checks AuthSession on every authenticated request,
so removed sessions fail closed. Exact serving LINE signup resolves ExternalIdentity and owned
memberships; retained legal evidence does not itself block a newly created user. Remaining user,
credential, membership, role and LINE tables match preservation evidence. No real old-token replay,
authenticated business browser journey or provider LINE/email signup was performed.

Fresh API/DB, AI, worker/Redis/internal-API readiness passed. Public health, OPEN, login and signup
returned200. API's3 error-keyword hits were informational route names containing “Exception”,
not errors. Worker errors are the startup incident above; all affected kinds recovered.
Private audit evidence: `.../20261004-uat-archived/impact-20261004/` — database.json, stores.json,
queues.json, queue-kind-recovery.json, changed-field-analysis.json, readiness.json, public.json,
summary.json and restricted logs/hash-only row comparisons.8/8 owned SSM sessions closed; the
read-only SDK module-path probe failed before DB/S3 access and was corrected to the known API
runtime root. Temporary local restore container/volume retired; production untouched.


## Production preparation authorization — 2026-10-04 Asia/Bangkok

User: “ต่อไป เตรียมตัวสำหรับ prod แต่ยังไม่ต้องลบ จนกว่าจะมีคำสั่ง ให้เตรียมไว้ก่อน”.
Preparation only. Do not apply/resume cleanup, stop/start services, change customer gate, run an
S3 write/delete permission probe, change IAM, deploy, or mutate application/provider data.
Read current cloud/release/cleanup runbooks and reuse the exact source/bundle verified on UAT;
source hashes match the committed UAT operation's provenance. Read-only inventory uses the scoped
non-root Production profile, enrolled strict-host-key SSM transport, PostgreSQL read-only default
plus read-only transactions, and existing API inventory authority. Output is private local evidence.
Private preparation folder: `/Users/thawatchai/.codex/cleanup-preparations/20261004-prod-archived/`.
No apply coordinator or scheduled execution is created. Deletion requires a new explicit owner
command, followed by fresh frozen preview and backup/restore proof. Preparation snapshots are not
frozen execution manifests because Production remains live and continues to change.
UAT/READY/Production workflow run IDs remain NOT_DISPATCHED for this read-only operation.


### Production preparation outcome — 2026-10-04 Asia/Bangkok

Prepared read-only inventory, all-company preview, legacy-storage diagnostics, scoped authority
proposal, backup/maintenance/recovery checklist and alternative-scope preview. No apply coordinator,
automation, Production backup/dump, file upload/delete, IAM edit or service/gate mutation. Production
execution remains explicitly unauthorized. Preparation is complete as evidence for review; this
is NOT a claim that all28 companies are currently executable by the script.

Verified4 enrolled containers: both API replicas, AI and workers remain running source
`908e7aab9b15561317609a67bac770b7ca8a2886` with original image/IDs/start times and0 restarts.
API/DB/AI/worker/Redis/internal-API readiness passed; public health/login200 and OPEN unchanged.
Legacy ECS `watchdog-bms-prod` has0 running tasks. Scoped non-root profile `mangmee-kamal-production`
and existing read-only ECS authority `watchdog-bedrock`; no owner/root resource access.
RDS endpointwatchdog-bms-prod-db.cpqecgikiwrq.ap-southeast-1.rds.amazonaws.com,
DBwatchdog_bms/PostgreSQL18.3, sampled size840,406,719bytes. Bucketwatchdog-bms-prod-311414082667;
Redis master.watchdog-bms-prod-redis.tp6lu7.apse1.cache.amazonaws.com. Final read found0 remaining
operator DB sessions. Read live source/container state rather than relying on historical inventory.

Company snapshot115 total:81ACTIVE,6DISABLED,28ARCHIVED. All28 DB preview passes ownership/
protected-user checks:58,738 rows,36 memberships,32 private users,1 preserved shared user with
2 memberships outside the selection,11 LINE IDs/identities,83 sessions,29 credentials.
Retain14 immutable legal rows. No BillingAccount selected; no external provider-state assertion.
All files/manifests are diagnostic snapshots of a live system, not an authorization or frozen apply.

The first all-company preview deliberately capped its operator process at256MiB and exited on its
own V8 heap limit; API remained healthy with0 restarts/OOM and no core files. Read-only sizing
found52,584 DashboardSnapshot rows (~79.3MB PostgreSQL row storage), explaining the memory need.
Host had~5.5GB available of8GB and no container memory limit. After proving that boundary, reran
only read-only preview with1024MiB heap, reduced CPU priority, core dumps disabled and>3GiB spare
memory guard. DB preview completed. A local sizing-summary camelcase bug was corrected offline
from already-saved results, without another database read or service mutation.

**Execution blockers — preserve these boundaries:**
1.3 legacy local-filesystem attachments across2 companies. Exact SHA256-derived paths from the
  real LocalStorageAdapter were absent in both current API containers and their2 hosts. This
  does not prove absence in a historical server or backup. Current cleanup intentionally rejects
  local attachments; no DB-only deletion/skip was substituted.
2.15 S3 versions with literal VersionId `null` across3 other companies. Current script rejects
  these. Diagnostic inventory found19 versions total (4 normal IDs,15 null),6,866,834bytes;
  bucket reports ObjectLockConfigurationNotFound, consistent with no bucket Object Lock.
  Keep exact inventory/backup/hash evidence and add/test explicit legacy support before any
  full execution; never remove the guard solely to force a manifest through.
3.Live CloudFormation declared worker deletion scope covers evidence/report/generated-substitute
  paths but excludes13 of those legacy null-version keys at old company-root paths. Prepared an
  unapplied `proposed-delete-authority-supplement.json` limited to DeleteObjectVersion on those
  exact13 key ARNs. This is a review proposal, not effective authorization or a tested delete.
  Do not broaden application roles/root authority. No S3 write/delete permission probe was run.

All3 local records and15 null versions involve5 companies, named/identified only in private
`legacy-scope.json` and `preparation-review.json`. A diagnostic alternative excluding those5
companies was also checked:23 companies,26 memberships,22 private users,4 preserved users,
44,182 rows,10 retained legal records. It correctly BLOCKS a cross-company LineWebhookEventLog
reference. It is NOT an approved execution subset; do not silently split or partially run it.
The full28-company DB plan has no such cross-company blocker.

Authoritative preparation artifacts (private directory0700/files0600):
`/Users/thawatchai/.codex/cleanup-preparations/20261004-prod-archived/`
- `authorization.json`: PREPARATION_ONLY; deletion/service-stop/gate-change=false.
- `preparation-review.json`: reviewable company list, account policy, blockers and future sequence.
- `preview-all.json`, `preview-compatible-subset.json`, `selection.json`: diagnostic only; blocked.
- `storage-diagnostics.json`, `legacy-scope.json`, `delete-authority-gap.json`.
- `s3-authority-readback.json`, `proposed-delete-authority-supplement.json` (unapplied).
- `survey.json`, `container-inventory.json`, `data-sizing.json`, `resource-sizing.json`.
- `readiness-before.json`, `public-before.json`, `legacy-ecs-readback.json`, `final-readback.json`.
- `provenance.json`: hashes of exact UAT-tested source bundle and retained preparation evidence.

Next state: HOLD. Resolve/rehearse legacy handling and exact delete authority locally before any
future apply; user must issue a new explicit deletion instruction. After authorization, stop all4
application writers through the approved maintenance procedure, then obtain a fresh frozen preview
and full DB/object backups, restore/rehearse and preserve all-table hashes before apply. Resume
API/AI to verified readiness BEFORE workers. Existing live snapshots must never be reused blindly.
All7 read-only transport receipts confirm28/28 owned SSM sessions terminated with0 failures.
Final preparation evidence hashes and private file permissions verified; no cloud work remains
running on behalf of this preparation. Production remains on HOLD pending a new owner command.

## Production hardening and IAM outcome — 2026-10-04 16:18 UTC

Owner expanded preparation to fix impact/bugs/gaps and create permissions with3hour sessions.
Explicit final exception: “อนุญาต root เฉพาะ bootstrap ชั่วคราว”. This supersedes only the earlier
no-IAM part of preparation; Production deletion, stop/start, customer gate, deploy and write/delete
probes remain unauthorized. No automatic apply coordinator/schedule exists.

Code: manifest/storev2 binds host/port/database without credentials, rejects target query overrides.
Streaming row hashes and releasing preview rows reduce locked-recheck heap. Keep owners with
outside onboarding runs; block foreign signup/email links and unselected attachment/report keys
or company-prefix overlap. Legacy inventory covers the whole company root, including orphan keys.
S3 null OBJECT versions require Enabled versioning and frozen SHA256/ETag/size/time, exact VersionId
and IfMatch; recheck content and locks before deletion/resume. Null DELETE MARKERS still block:
MinIO's explicit null deletion did not remove that marker; no such marker is in Prod's19versions.
Local files require explicit canonical roots, adapter-derived paths, absent/hash snapshots and
symlink/hardlink/change guards. Historical servers/backups are outside this physical-erasure proof.

Real code checks: PostgreSQL18.3 with244actual migrations, MinIO and Redis fixtures passed15tests,
0failed,0skipped. CLI prod/uat labels point only to local fixtures. Covers foreign ownership,
legacy current/noncurrent null files, disabled versioning, retention/hold, missing/stale/changed
files, local multiple roots, wrong delete authority (no reader fallback), post-commit replacement
preservation and Redis failure/resume. Exact command:

```sh
CLEANUP_TEST_DATABASE_URL='postgresql://postgres:cleanup-local-only@127.0.0.1:59048/cleanup_test' \
CLEANUP_TEST_S3_ENDPOINT='http://127.0.0.1:59049' \
CLEANUP_TEST_REDIS_URL='redis://127.0.0.1:59051' \
pnpm --dir apps/api exec tsx --test \
  src/scripts/cleanup-archived-local-files.spec.ts src/scripts/cleanup-archived-companies.pg.spec.ts
NODE_OPTIONS=--max-old-space-size=8192 pnpm --dir apps/api exec tsc --noEmit --pretty false
```

Both passed after the final code edits. Actual CLI capacity check with1024MiB heap handled52,584
synthetic payload rows (~78,876,000bytes): preview2326ms, apply5760ms;10unrelatedrows preserved
byte-for-byte. Fixture-only table/companies retired. No package.json/dependency/runtime/UI/schema
change; no frontend deploy/E2E claimed. Test and typecheck logs retained in private evidence.

Live read-only hardened review:28ARCHIVED,32privateusers,1shareduser,58,738rows,14retainedlegalrecords,
0newDBguards. Expanded prefixes still19versions,15null,0newobjects. Versioning metadata reads were
missing from API runtime authority; the new operator role resolves this without editing the API.
DB SELECT/DELETE privilege readback covers257tables; Redis ACL DRYRUN allows DEL/HDEL/ZREM/LREM/
EVAL/EVALSHA/SCAN with0actual writes. Same4containers/source/readiness/OPEN confirmed. Both new
transport receipts closed4/4SSMsessions each; combined with first preparation36/36closed.

IAM durable role `watchdog-bms-prod-archived-cleanup-20261004`, RoleId `AROAURANZZRVUGZC6B72V`,
account311414082667, MaxSessionDuration10800. TrustonlyIAMuserwatchdog-bedrock-dev and
`archived-cleanup-prod-*` session names. Inline `ReviewedArchivedFixtureObjects` compact6930bytes,
SHA256 `57cbb732f53c2a12546adf70d144a3523130c4dda165ab062d775c5bf922c61a`.
Read targetbucket metadata and exact19keys; DeleteObjectVersion exact19key/version pairs only.
No attachments/permissions boundary; no PutObject/unversionedDelete/bypass/IAM/otherbucket.
Application roles unchanged. Bucket metadata listing is bucketwide; content read is exactkey.

Non-root initial creation succeeded without optional tags; current user lacked durable UpdateRole/
PutRolePolicy-related setup authority. Root temporary bootstrap was explicitly approved, adapted
from the repository fail-safe ceremony wrapper to one exact cleanup role. Non-root assumed that
bootstrap and configured duration/policy. First verifier failed because negative IAM simulations
lacked the s3:VersionId context; correct implicitDeny was returned. Bootstrap cleanup still ran,
and independent absence proof passed. Fixed verifier context, skipped already-matching durable
mutations and reran verification.19 allowed+7denied tests passed. Both wrapper invocations retired
all temporary authority; final independent get-role/get-role-policy/get-user-policy returned
NoSuchEntity at16:17:57UTC. No root durable-role or data mutation.

Actual newrole AssumeRole requested10800seconds and succeeded; session expiry19:17:38UTC.
Read List/Head/Get all19versions (6,866,834bytes) and stream hashes passed, bucketEnabled/noObjectLock.
Credentials stayed in process memory and were discarded; role remains available for fresh3h
sessions when execution is authorized. Delete permission proof is IAM simulation only, not a live
DeleteObject call. Null version IDs must stay content-pinned in the manifest because IAM cannot
pin their bytes. Any changed/new inventory needs fresh review; no wildcard expansion.

Private follow-up directory:
`/Users/thawatchai/.codex/cleanup-preparations/20261004-prod-archived/hardening-20261004/`.
Key evidence: production-read-only-review.json, database-cache-authority.json, capacity-result.json,
bootstrap-authorization.json, bootstrap-retirement-first-attempt.json, bootstrap-retirement-proof.json,
iam-provision-result.json, iam-policy-simulation.json, operator-assume-read-proof.json,
preparation-final.json and final-provenance.json. Earlier initial evidence remains historical;
its read-only authorization and stale bundle are not overwritten as current execution artifacts.

Next: HOLD. Await an explicit deletion command. Before apply, make the actual authoritative temp
roots of both API containers and both hosts accessible to the operator and freeze mount topology;
current file absence checks are not mounts or proof about old servers. Then stop all writers,
fresh full28company preview, exactpolicy reconciliation, fullDB/object backup, restore/rehearsal
and all-table preservation hashes. API/AI readiness must pass BEFORE workers resume. Real provider
email/LINE re-registration remains post-cleanup acceptance. All release IDs NOT_DISPATCHED.

Final retirement:3 task-owned PostgreSQL/MinIO/Redis containers and anonymous volumes removed;
absence verified. Existing ownercheck containers untouched.36/36 preparation SSM sessions closed.
CLI --help and git diff --check passed; private evidence directories0700/files0600. Final bundle
and source/evidence hashes saved; original read-only review bundle retained separately. No commit,
push or PR; unrelated working-tree edits preserved. No cleanup process remains running.

## Pre-deletion checkpoint preparation — 2026-10-04 Asia/Bangkok

Owner authorized starting preparation but explicitly instructed pausing before actual deletion.
Owner selected keeping Production OPEN while waiting. Proceed with live read-only review,
consistent pg_dump/object backups and local restore/rehearsal; no service stop/start, no gate
change and no Production data deletion. Future frozen preview/backup remain required after
a separate deletion command. Current private checkpoint: `/Users/thawatchai/.codex/cleanup-preparations/20261004-prod-archived/predelete-checkpoint-20261004T163405Z`.
Status: preparation in progress; no live apply/resume coordinator. Run IDs NOT_DISPATCHED.

### Pre-deletion checkpoint result — Production stays OPEN

Preparation completed and paused before deletion as instructed. Exact28company/32privateuser/
1shareduser/58,738row scope unchanged;14legal records retained. No Production apply/resume,
service stop/start, gate mutation, IAM change or deployment. No command waiter was installed.

Live read-only pg_dump used the previously verified immutable PostgreSQL18 client on APIA,
TLSverify-full,5second lock wait,512MiB/1CPU limit and sufficient host memory/disk. Applications
kept running. Backup31,507,821bytes SHA256
`c56618c6b180b7e9a7b7b083dea7b67001764bd8e2e2125761770d44744dd191` matched source/download.
Full restore in task-owned localhost PostgreSQL18.3 succeeded; actual cleanup plan's schema/row
hashes match the live review. Actual DB cleanup ran ONLY in that local clone. All346,150preserved
rows matched across257tables with0incidental SET NULL changes. Clone ended81ACTIVE/6DISABLED/
0ARCHIVED companies; original Production still has the28ARCHIVED targets. No external-store
cleanup was invoked by the local database rehearsal.

Downloaded19exactS3versions/6,866,834bytes using a fresh10800second cleanup-role session;
streamed/readback hashes matched earlier reviewed content including15nullversions. No object
write/delete or provider message. Credentials discarded with the process.3local attachment paths
rechecked using each current API's os.tmpdir and each host's tempfile.gettempdir:12checks across
4locations all absent. These are live read-only observations, not frozen mounts and not a claim
about historical machines/backups.

Same4containers/image IDs/starttimes/restart counts; API/DB, AI, workers/Redis/internalAPI ready,
PlatformAccessOPEN after backup. Temporary remote dump/CA/staging and owned release lock retired;
4/4SSMsessions terminated. Pinned PostgreSQL client image remains cached for future backup;
no application image/config/container changed. Disposable local restore container and anonymous
volume retired after rehearsal; recovery dump/object backups retained privately.

Private checkpoint `predelete-checkpoint-20261004T163405Z/` under the preparation directory:
`checkpoint.json`, `authorization.json`, `live-review.json`, `authoritative-local-readback.json`,
`watchdog_bms.prod.preparation.dump`, `database-backup-transfer.json`, `restored-database-plan.json`,
`database-rehearsal-proof.json`, `expected-after-rehearsal.json`, `object-backup-proof.json`,
`object-backup/*.bin`, `post-backup-readiness.json`, logs and `provenance.json`.
The source remains identical to the15/15tested hardening version. Helper syntax, actual restore/
rehearsal and hash checks pass. No application code/package.json changed in this turn.

Next: WAIT FOR EXPLICIT DELETION COMMAND. Keep Prod OPEN. Before real execution, prepare access to
all authoritative temp roots and freeze topology, stop all writers in an approved window, generate
fresh v2full preview and reconcile exactIAM scope, take/restore fresh frozen backups and preservation
proof. This live snapshot is recovery/rehearsal evidence, NOT a frozen execution manifest.


## Explicit Production execution authorization — 2026-10-05

Owner now said “เริ่มได้เลย” in direct reply to execution duration. This authorizes the reviewed
28-company/32-private-user Production cleanup and necessary maintenance; prior deletion HOLD is
superseded. Preserve shared users and immutable evidence. Scope drift blocks before mutation.
Current execution evidence: `/Users/thawatchai/.codex/cleanup-backups/20261005-prod-archived-171739Z`. All release workflow IDs NOT_DISPATCHED.
Resolve actual local filesystem access before stopping writers: native read-only bind mounts hold
the existing API temp filesystem; temporary SSHFS inside an isolated operator container exposes
the second host over enrolled strict SSH/SFTP. No application code or image changes. Native tool
installation is confined to the disposable operator container. No Production deletion yet.


### Production database committed; exact S3 resume required

Operation `archived-cleanup-prod-171739Z`, frozen manifest digest
`550f24057d7099fec9a33f3ddd23466bd5616b1c88db544a7ff34856725a665c`.
All four writers stopped at2026-10-04T17:35:01Z; no other DB clients. Frozen full DB backup
31,526,404bytes restored/rehearsed locally;257tables/346,400preservedrows match,0SETNULL.
19exactversions backed up and downloaded hashes verified. Actual DB phase committed.
AWS then rejected the first legacy null DeleteObject carrying VersionId+IfMatch. Durable receipt
is `DATABASE_DELETED_EXTERNAL_PENDING`; no second DB apply is permitted. Four services remain
stopped and the operation release lock retained. Native authoritative temp mounts remain held.
Root cause: AWS conditional deletes evaluate only current objects and reject this exact-version
combination; MinIO accepted it. Fix omits only the DeleteObject IfMatch header, retains conditional
GetObject SHA256/ETag/size/time check, Enabled versioning, stopped writers and exact VersionId.
Add the AWS request restriction to the real CLI/MinIO regression before external-only resume.

### Final Production result — OPEN; coupon decision pending

Completed2026-10-04T17:54:17.660381Z (October5 Asia/Bangkok). Authorized manifest removed
28ARCHIVED companies,36memberships,32private users and58,738DB rows; preserved1shared user and
14immutable LegalDocumentActionRecord rows. Deleted19exactS3versions (15legacy null,4normal;
6,866,834bytes). Three local attachment references were absent at all four authoritative roots,
12checks before/after. No unselected physical files were removed.

Frozen recovery dump31,526,404bytes SHA256
`5b42cda8171a426e8b85b962d662890670957a882a34de689e3fb5aab62d21d2` restored and rehearsed locally.
Full257-table preservation proof matched all346,400preserved rows,0incidental SET NULL, both
after DB commit and before stores-only resume. The resume used the original v2manifest digest
and committed receipt; DBapply1, externalresume1. Actual provider deletion succeeded without
IfMatch on DeleteObject, under the existing19key/version policy. Conditional GetObject and
SHA256/ETag/size/time, Enabled versioning and stopped-writer guards remained. Real migrated
PostgreSQL18.3/244migrations +MinIO/Redis regression15/15PASS,0skip; API typecheckPASS.

Maintenance2026-10-04T17:34:51.717600Z–17:54:13.380057Z (19m22s). Original four containers/images
and source908e7aab9b15561317609a67bac770b7ca8a2886 resumed. API/AI readiness passed BEFORE
workers. Public health, PlatformAccessOPEN, login open-marker and signupHTTP200 passed. No
application deploy, customer-gate/IAM change or root use during this execution. UAT/READY/PROD
workflow IDs NOT_DISPATCHED. A real provider email/LINE registration journey was not exercised.

Post-open impact audit inspected579reference fields and392FKs across257tables:0FK orphans,
0unvalidated FKs,0selected-company/account residues,0selected jobs/cache across36queues,
0newDLQs,0error-like log lines in all four services. Both SYSTEM_ADMIN users/memberships and
2live-mode billing accounts remain. Five tables naturally changed after application restart;
the all-row equality proof refers to the frozen interval, not post-open activity.

One unresolved scope gap: serving source has SalesEventTicket.holderProviderUserId, absent
from this checkout's Prisma schema and explicit LINE soft-edge list. Its global ISSUED ticket
is outside the company/FK plan (companyId/attemptId/invoiceId/redeemedAs all null),100baht,
issuedSeptember29, expiresOctober30. No delete was attempted. Owner was asked keep/delete;
owner instead asked “ร้านชื่ออะไร”. Frozen backup maps its holder to one historical account
and ARCHIVED company **อินทิรา** (`cmtxs9vgt0h1q204dh58o3jd0`). Answered this distinction;
the ticket itself has no company assignment. Keep decision PENDING until an explicit answer.
Do not claim all private LINE references erased or silently expand the original manifest.
Before another cleanup, reconcile this newer global-benefit ownership rule against serving
schema/code and update preview/report/guards with a focused test; current script lacks that guard.

Temporary remote operator, SSHFS/native bind mounts and owned staging on both API hosts retired.
Four task-owned local containers/volumes removed; existing user containers preserved. Release
lock absent, APIs still running;76/76owned SSM sessions from19connections closed. Recovery
DB/object backups, manifests, logs and receipts retained privately (directories0700/files0600).
Durable scoped cleanup IAM role remains as previously authorized; sessions last at most3hours.

Private operation directory above contains `completion.json`, `preview-final.json.result.json`,
`verification-after.json`, `database-backup-proof.json`, `object-backup-proof.json`,
`resume-fix-verification.json`, `services-resumed.json`, `public-after.json`, `impact-summary.json`,
`impact-database.json`, `impact-queues.json`, `impact-log-summary.json`,
`ticket-owner-company-lookup.json`, `retirement.json`, `transport-retirement-summary.json` and
`final-provenance.json`. Keep ticket identifiers/private LINE data out of public documents.
No commit, push or PR; unrelated working-tree changes preserved. No cleanup/waiter process runs.

### Coupon follow-up — explicit owner approval and completed deletion

After identifying the historical shop as อินทิรา, owner said “ลบได้เลย”. This separately authorizes
the one previously described unused100-baht global coupon, not other tickets/campaigns. Reviewed
exact serving source908e7aab: claim-event-discount.use-case.ts issues under the batch row lock,
increments lifetime issuedCount and writes a non-PII issuance AuditLog. sales-events.service.ts
explicitly keeps the lifetime cap consumed after revocation. Preserve this counter and audit;
no application, IAM, gate or deployment change. UAT/READY/PROD run IDs NOT_DISPATCHED.

Fresh read-only scan of257tables found only one issuance AuditLog referencing the ticket id/serial;
no incoming FK or custom trigger on SalesEventTicket. The target still matched the exact earlier
snapshot:ISSUED/version1/100baht, no company/attempt/invoice/redemption/reservation/use/revocation,
no rewards. Its holder had no new ExternalIdentity or signup. Saved the complete row, parent
batch and issuance audit privately before mutation; original successfully restored frozen dump
also contains the identical ticket. No full Production restore or company-cleanup reapply ran.

Separate transaction used SERIALIZABLE isolation,3s lock timeout/30s statement timeout, batch
then ticket row locks (matching the claim flow), snapshot equality and an exact-id+full-row DELETE.
Committed2026-10-04T18:12:04.488Z (2026-10-05 01:12Asia/Bangkok), exactly1row. Before COMMIT,
all other7ticket row hashes, the complete parent batch and issuance audit matched. Independent
post-COMMIT SELECT found0tickets for all removed private LINE IDs. One apply invocation, no retry.
Historical main cleanup58,738-row receipt remains unchanged; this authorized supplement adds1row.

Production stayed OPEN with the original application containers continuously running. Deep health
passed before mutation; final public health/OPEN/login open-marker/signupHTTP200 passed at
18:12:44Z. No service stop/start or gate change. Owned release lock released,8/8additional SSM
sessions closed (84/84including main execution). No remote files/operator/container were created.

Private evidence: `/Users/thawatchai/.codex/cleanup-backups/20261005-prod-archived-171739Z/coupon-followup/`:
authorization.json, review.private.json, completion.private.json, completion.json, public-after.json,
review-readiness.json, apply-readiness.json, ticket.cjs, operate.py, recovery-notes.txt and provenance.json.
Files0600/directories0700; no credentials printed or persisted. Historical pending-coupon reports
remain unchanged evidence; this completed supplement supersedes their unresolved decision.
The general CLI still needs SalesEventTicket preview/ownership guard coverage before another run;
one-ticket authorization does not define a blanket deletion rule. Real provider signup untested.
