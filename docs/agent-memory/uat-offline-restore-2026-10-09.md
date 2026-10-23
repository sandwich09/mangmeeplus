# Agent Memory: UAT offline restoration — 2026-10-09

Status: RESTORED_UAT_OPEN_SMOKE_ACCEPTED — owner authorized “แยก agent กู้ UAT ต่อเลย”.
Current power state: paused again at the owner's request “ปิด uat” on October10; both restored application hosts stopped, data retained and Production healthy/OPEN. See [latest power-pause evidence](uat-power-pause-2026-10-10.md). The signed restoration result below remains unchanged historical evidence.
Owner: delegated UAT restoration agent; parent coordinated UAT Cloudflare/providers and previously completed Production acceptance.
Scope: Restore and reopen UAT from the October7 offline backup. Production, Dev and Official OA are outside this operation.
Decisions:
- Operation `20261009-uat-restore`; UAT/READY/Production workflow IDs `NOT_DISPATCHED`.
- Pin last accepted UAT `20261005T155337Z-20348016`, source `67c270d3cf5e46bff367d2e84e76f8efd6bb9e27`; restore original data/config/images where retained, no latest-main rebuild.
- Canonical UAT smoke acceptance requires complete config/deep readiness/public OPEN and verified signature; login/logout not required under the retained UAT protocol. The signed receipt does not claim a fresh authenticated or real LINE journey; subsequent owner confirmation is recorded separately below.
- Separate private evidence and UAT guard; no shared Production resource mutations or duplicate workflow dispatches.
Open questions: none requiring owner input at discovery.
Artifacts: private `/Users/thawatchai/.codex/offline-restores/20261009-uat`; original archives unchanged.
Verification: read cloud environment, V2 deployment, Kamal and Ponytail instructions. UAT old target preserved; no prior active UAT guard.
Next: None for this restoration. Future feature deployment must reconcile the controller’s retired ECS baseline; do not recreate obsolete ECS resources to bypass it.

## Owner confirmation after signed acceptance — 2026-10-09 (Asia/Bangkok)

After confirming the restored LINE UAT connection, the owner reported “ใช้ได้แล้ว เมื่อกี้ลองแล้ว”.
This confirms the owner successfully tried an actual LINE UAT AI conversation. The previous
real-conversation verification gap is closed by owner report; no additional agent test or log
correlation was performed. The original signed smoke receipt and its evidence remain unchanged.

## Final signed acceptance — 2026-10-09T09:34:56.944964+00:00

- UAT is online at https://uat.mangmeeplus.com. Public health200, customer gateOPEN and login200/open marker pass. A preexisting browser session rendered the UAT dashboard; no fresh login/logout or business mutation was exercised. Canonical UAT smoke protocol remains the acceptance scope.
- Cloudflare UAT Worker active789e0268 at100%Ready uses uat-origin.mangmeeplus.com; public proxied CNAME points to the same origin. Only UAT routing/provider settings changed.
- LINE channel2010784371, bot@234jrspv, now uses https://uat-origin.mangmeeplus.com/v1/line/webhook. Provider empty-event checks before and after the single endpoint update passed200. A real user AI conversation was not exercised. Original Postmark/Stripe test callbacks reached their authentication boundaries (401 for empty unauthenticated requests); no email or payment was generated.
- All runtime/source/config/dependency checks, original data comparison, S3 version reconciliation, original archive hashes, infrastructure checks and13UATalarms passed. All temporary remote transfer files, isolated local containers/volumes and owned SSM channels are cleaned; raw historical SSM status-label lag is preserved below.
- Final receipt state `RESTORED_UAT_OPEN_SMOKE_ACCEPTED`, SHA256 `50a77dc299b39b70e6ebc539f721dcbadbc6ad3ac98d228a52f7e5d4b97084e1`. Non-root mangmee-kamal-uat-deploy KMS ECDSA_SHA_256 signature verified. Canonical target equals the signed candidate, with both restored hosts/origins; only this operation’s active guard was removed. All 53 signed evidence hashes rechecked locally after enrollment.
- Private receipt: `~/.codex/offline-restores/20261009-uat/restoration-accepted.json`; signature/result/enrollment/consistency proofs sit alongside it. UAT/READY/Production workflow IDs remainNOT_DISPATCHED; no commit, push or application rebuild. Production remained healthy/OPEN in the parent’s final read-only check.
- Original UAT topology is retained: RDS SingleAZ/1-day backup and single private Redis node without TLS/auth. Dev and Official OA remain retired. Running UAT resources incur AWS charges again.

## Data restored — 09:00 UTC

- All342S3versions/261.8MB downloaded and SHA256/size verified;6latest delete markers recreated. A second idle-connection disconnect occurred after332accepted objects. Fresh live inventory matched all332retained receipts; the remaining10objects/3.24MB were uploaded once each using fresh connections. Both original failures and reconciliations retained; no accepted business-object version overwritten.
- Remote UAT PostgreSQL full dump restored once transactionally with original owners/ACLs and3custom role credentials. All268tables/120575rows, sequences and extensions matched original backup before S3 reconciliation. The rehearsed332AttachmentObject and6ExpenseCaptureReadJob `objectVersionId` changes match the remote result.310ACTIVE attachments covered;17unmapped inactive rows retained. No other field/count/sequence/extension changed. Six job manifest/checkpoint JSONs have no old object-version references.
- Exact temporary Redis seed version and its two-statement service grant removed after live cache/offline queue parity. Seven current UAT runtime parameters restored; obsolete ECS endpoint parameters remain retired.
- Both original downloaded backup archives freshly rehashed and unchanged. Local verification fixtures remain isolated until final cleanup.
- Publishing the four original immutable images to recreated UAT ECR. Original scoped role works and verifies the prior signed acceptance. No runtime application containers started yet.

## Infrastructure and isolated proof checkpoint

- Old signed UAT receipt verified again with restored UAT key `cb315bdc-b5ab-42fb-be32-fe9cee2a2d44` using non-root `mangmee-kamal-uat-deploy`. All four exact published Docker images remain locally available; no rebuild.
- Restored24UAT secret values exactly. RDS `watchdog-bms-uat-db` available with former endpoint, PostgreSQL18.3/db.t4g.micro/SingleAZ/20GiB/private/encrypted/1-day backup. UAT Redis remains its original single cache.t4g.micro Redis7.1 private plaintext/no-auth topology;5738nonexpiredkeys and queue wait3278/delayed36 match offline, with no old S3VersionId references. This restoration does not claim encryption/auth was added.
- Stack `mangmee-kamal-uat` CREATE_COMPLETE after reviewed41Add-only resources. API `i-0248e3a31d9b75ad1`, AI/workers `i-0ef193d594e475a65`; bootstrap/Kamal proxy/strict host keys verified, public TCP22 closed, both owned SSM sessions terminated. No Dev connection stack restored.
- Dedicated UAT ALB `mangmee-uat-gateway-209016683.ap-southeast-1.elb.amazonaws.com`; ACM62790bc6-3cd6-4516-8d85-28b93e9e2fd4 ISSUED. Parent added DNS-only uat-origin/uat-ai-origin plus validation CNAMEs. Public uat Worker/CNAME remain unchanged until runtime readiness. Routing change set has exactly2Add rules and remains unexecuted.
- AgentCore recreated with exact original source/artifact, stable kamal_uat_a/b endpoints READY. Config validators from actual images pass; only origin/runtime topology bindings changed.
- Isolated PostgreSQL restore matches all268tables/120575rows, sequence and extension hashes. Original Dev database inside the backup is outside this UAT scope and remains offline.
- First S3 transfer stopped on RequestTimeout; live reconciliation proved161accepted versions, one per key, no unexpected business keys. Sequential continuation verifies existing hashes and uploads only missing objects; original failure retained.342UATversions total. No blind overwrite or duplicate object versions.
- Initial local Redis fixture entrypoint tried chown on the read-only RDB mount and exited; original RDB remained unchanged. Retained inspection explains correction: task-owned failed fixture retired, explicit redis-server entrypoint used inside network:none. Corrected offline queue audit passed.
- Read-only workflow guard encountered historical metadata ghost31611733340. Fresh exact Aug12timestamps/source33ed788c/checkSuite85752682208 and zero jobs/check-runs/pending deployments match the documented incident; exclude only this identity. No cancel/delete/rerun, and no executable release workflow overlaps.
- Parent restored3Kamal log groups at3days,8original metric filters,13UAT alarms with original thresholds/action lists; existing confirmed SNS referenced without mutation. UAT bucket CORS and original SSE-C blocking readback/real OPTIONS passed. Provider audit confirms UAT LINE channel2010784371/bot@234jrspv; webhook still points to retired ECS pending readiness. Postmark20950027 and Stripe test callbacks retain public UAT hostname.

## Publication checkpoint — 09:19 UTC

- Original API/AI/workers image digests are published and verified. The tools image publisher remains the same process; two large layers are pending. Docker outbound counters increased419540bytes over one second at09:19:20UTC, proving transfer progress despite no completed-layer log since09:06. No second publisher or blind retry.
- All13UATalarms currently OK before application boot. Runtime, routing, final source/config/dependency readback, scoped cleanup and signed target enrollment helpers are prepared.
- Shared AI/workers host references were reconciled locally to the same previously verified host key; both reference entries now carry that key, with no new host trust accepted. Evidence is bound into the final acceptance prerequisites.

## Runtime start — 09:24 UTC

All four exact original images are now published and their retained immutable digests verified; the single publisher exited0. Started the guarded API/AI phase once, after bulk upload ended. Public UAT/provider cutover remains pending readiness.

## Runtime and cleanup verified — 09:33 UTC

- API, AI and workers each run exactly one original-source container. All images/configurations, migration catalog and original feature build authority verified. No migration/sync or customer-gate mutation. API DB readiness, AI health, workers Redis PING and internal API readiness pass.
- Executed the reviewed two-Add routing change set once. Stack UPDATE_COMPLETE; both ALB targets healthy; uat-origin/uat-ai-origin TLS and /v1/health return200. Parent handles the separately authorized public Worker/CNAME and UAT LINE endpoint changes.
- Final infrastructure check: original RDS/Redis sizes/topology, private/versioned/encrypted S3, HTTPS certificate, public SSH closed,3-day logs, all13UATalarmsOK. Fresh workflow inventory has zero executable releases; exact historical metadata ghost unchanged.
- Remote transfer dump/CA were hash-verified then removed from their exact task directory. Both local network-isolated fixture containers and their dedicated volumes removed; original archives and Docker images retained. Cleanup initially rejected Docker Desktop's /host_mnt prefix before any mutation; exact read-only backup paths reconciled, failure retained.
- All10owned TerminateSession calls were accepted. Independent readback proves every session in History has EndDate, zero owned sessions in Active, and zero local transport processes. Six raw history labels sayTerminated and four remainTerminating; stale labels are retained honestly in evidence, with no duplicate termination solely to alter metadata. This follows the existing controller cleanup contract and AWS DescribeSessions/EndDate semantics.
