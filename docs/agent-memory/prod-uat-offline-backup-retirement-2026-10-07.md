# Agent Memory: prod-uat-offline-backup-retirement-2026-10-07

Status: COMPLETE. Authorized AWS retirement verified; original and supplemental offline archives packaged and fully read back successfully.
Owner: current user / Codex.
Scope: verified offline preservation, then retire Production, UAT, shared infrastructure, Dev and Official OA AWS resources to stop recurring charges.
Decisions:
- Owner first authorized backup, then said “ลบได้เลยเพื่อหยุดค่าใช้จ่าย”. After exact scope review, owner also authorized “ลบทั้งหมด โดยเก็บข้อมูลที่จำเป็นลงเครื่องก่อน” for Dev, Official OA and the local bucket.
- Read cloud operations and release runbooks; use ponytail full. No application code, package.json, deployment or release changes. UAT/READY/Production run IDs: NOT_DISPATCHED.
- Existing owner authority used for the authorized teardown; Production RDS and Redis deletion submitted through Console. No identity policy expansion. Temporary narrowly scoped service bucket permissions enabled log/Redis exports; those buckets were subsequently deleted.
- Preserve unrelated working-tree changes. Original verified database archive remains unchanged.
Open questions: None for the authorized AWS retirement. External provider subscriptions/accounts are outside this task.
Artifacts:
- Original verified DB/application-file archive: `/Users/thawatchai/Downloads/mangmeeplus-prod-uat-backup-20261007.tar.gz`.
- Private backup source: `/Users/thawatchai/.codex/offline-backups/20261007-prod-uat/`.
- Supplemental data and operation evidence: `/Users/thawatchai/.codex/offline-backups/20261007-retirement/`.
Verification:
- Final readback 2026-10-07T03:26:14.985797Z (10:26 Bangkok): all 42 resource checks returned zero. All other 17 enabled regions were empty in the 18-region scan of core infrastructure/storage services.
- No nonterminated EC2, EBS volumes/snapshots, RDS/backups/proxies, Redis/backups, ALB/target groups, EIPs, endpoints/NAT, ECS, ECR, S3 buckets, Lambda, AgentCore runtimes/memories, CloudWatch logs/alarms/dashboards, active secrets, SSM parameters, SNS, EventBridge rules/schedules or Backup vaults remain in the verified scope. Additional EKS/EFS/DynamoDB/Redshift/OpenSearch/MemoryDB/SageMaker checks are empty.
- All five CloudFormation stacks DELETE_COMPLETE; eight instances terminated and all 308 GiB EBS removed. All 39 RDS snapshots and 37 Redis snapshots, including two supplemental final exports, removed.
- 49 secrets marked for deletion; four customer KMS keys PendingDeletion, due October 14. AWS charges no storage fee while these are pending deletion. AWS-managed keys/free IAM and network settings may remain; account is not closed.
- Original five PostgreSQL restore/content checks and 704 exact S3-version checks passed. Supplemental Dev 10,736 files matched source; both Redis RDB checksums passed (1,682/6,755 keys); all additional S3 files passed size/hash checks before deletion. Eight historical log exports plus 150,581 recent log events retained locally.
- No RI, RDS reservation, Redis reservation or Savings Plan found. Cost Explorer history was used to cross-check charged services; accrued costs and billing-report delay remain. Do not promise an immediately zero invoice or cancel external Cloudflare/LINE/Postmark/Stripe subscriptions by inference.
Next:
1. Keep both verified archives private. No further cloud mutation is needed for the authorized scope.
2. Recovery requires new infrastructure plus offline restoration; previous start procedures cannot revive deleted resources. Pending Secrets/KMS deletions finish automatically on/after October 14 without storage charges during the waiting period.

## Authorized backup execution

- Existing owner Console account311414082667 started both exact RDS instances once. Shared bastion i-0f3b3881690dcf874 started using existing non-root authority. Application hosts remain stopped; legacy ECS RUNNING lists are empty for both environments.
- S3 original inventories downloaded:361Production versions/282355031bytes and342UAT versions/261792541bytes, plus2/6delete markers recorded. All703objects downloaded with exact version, byte-size and ETag/MD5 verification; individual SHA256 manifests retained privately.
- Production uses recorded interactive SSM on the bastion, existing read authority and TLS verify-full. Task-owned backup output may be staged encrypted under its existing permitted support-output prefix before download and exact-version cleanup.
- UAT uses the documented bastion tunnel on localhost55439 with PGHOSTADDR plus actual RDS PGHOST for TLS verify-full. No production database port-forward or IAM/network changes.
- Owned sessions: watchdog-bedrock-dev-3apns664e3z2v99ft7i9yznav4 (interactive backup); watchdog-bedrock-dev-6i2oul2fit6z94tvkzt2ydyxgu (UAT tunnel). Both must terminate before completion.
- Bastion's installed PostgreSQL16.14 cannot dump PostgreSQL18. DNF install of18 failed at transaction test on package conflicts before changing installed packages. Official cached18.4RPMs were extracted only into task-owned /tmp/offline-backup-20261007/pg18; pg_dump18.4 verified. Preserve installed16 and remove only task-owned files after successful download.

## Verified data and recovery

- Production watchdog_bms:268tables/355102rows, custom dump26837295bytes,
  SHA256`11dab740ca07a8c2a7510956066f2c179a4b00d442bc133b72abcbf6cd201665`.
- UAT watchdog_bms:268tables/120575rows, custom dump15155025bytes,
  SHA256`5d47318a1c8ec74d5e83653cda6e635851f10f27cdd86a6e831c49081744329f`.
- Included UAT's additional kamal_dev_07824efc DB:216tables/10488rows,1385326bytes;
  both auxiliary postgres databases were also backed up. The initial UAT inventory guard
  found this unexpected extra database before dumping; scope was expanded to preserve it.
- All5dumps restored successfully in isolated PostgreSQL18.3 (network none). All table
  counts/content hashes, sequences and extension catalogs equal source. Source hashes stable
  before/after each dump. Portable restoration uses no-owner/no-acl; original owners/grants
  and password-free role definitions remain in the backup.
- Final S3 backup includes704versions/544192486bytes: original703plus this operation's audit
  transcript. All704size/ETag-MD5 checks pass, with per-file SHA256 and exact version metadata.
  No original source version disappeared between the initial and final inventories.
- All ACTIVE attachments covered:255Production S3,310UAT S3 plus1UAT database blob.
  Source inventories lack bytes for3Production/17UAT non-ACTIVE references; their DB records
  are preserved. No ACTIVE attachment is missing.
- Recovery configuration saved locally0600:49current environment secrets,62runtime parameters,
  bucket policies/encryption/versioning/lifecycle metadata. No secret values printed.
- Both owned SSM sessions independently read back Terminated. Task-owned remote staging removed;
  installed bastion client remains16.14. Exact temporary S3 transfer version
  `43Um70goK98YA4ZRqZEq8KPVIKtF4a8c` retired only after verified local restoration; no original
  AWS object/data was deleted. Disposable labeled local restore container/volume removed.
- Both RDS stop requests submitted once through owner Console. Bastion stop was denied to
  non-root; owner authority stopped the exact backup bastion. At00:50:43UTC all8EC2instances
  and UAT RDS are stopped; Production RDS remains stopping. UAT auto-restart is
  2026-10-14T00:49:48.733Z (07:49Bangkok). Stop is not permanent cost elimination.
- No application deployment/gate/IAM/network changes; UAT/READY/PROD IDs NOT_DISPATCHED.
  This is a database/attachment backup, not an EC2 disk image or Redis queue/session snapshot.

## Delivery and terminal readback

- Final readback2026-10-07T01:02:10Z (08:02Bangkok): both RDS and all8EC2instances stopped.
  Production automatic restart2026-10-14T00:57:47.577Z; UAT00:49:48.733Z.
- Deliverable `/Users/thawatchai/Downloads/mangmeeplus-prod-uat-backup-20261007.tar.gz`,
  573721632bytes (573.7MB), mode0600. SHA256
  `5438414c04b540d03b404a7a04f70a67a2800df754be2c43a77ed2b7554187d6`.
  Adjacent `.sha256` file retained. All1473payload files were read back from the archive and
  matched individual SHA256 entries; internal SHA256SUMS is the1474thmember.
- README.txt includes restore instructions, S3 VersionId reconciliation, privacy/role handling,
  non-ACTIVE missing-source limitations and remaining cloud-cost scope. Private source backups
  and full machine-readable proof remain in the directory recorded above.
- Documentation-only diff check passed; actual5database restores and704object byte/hash checks
  are the verification for this operator task. No application test/deploy claimed.

## Authorized whole-account retirement in progress

- Owner: “ลบได้เลยเพื่อหยุดค่าใช้จ่าย”; subsequent scope answer: “ลบทั้งหมด โดยเก็บข้อมูลที่จำเป็นลงเครื่องก่อน”. This includes Dev, Official LINE OA and watchdog-bms-local. No further deletion approval is required within that scope.
- Original 573721632-byte archive hash reverified before deletion; unchanged. Additional private evidence/backups: `/Users/thawatchai/.codex/offline-backups/20261007-retirement/`.
- Production deletion protection disabled through owner Console; both exact RDS Delete requests submitted through Console without final snapshot or retained automated backups. Both entered deleting.
- Production and UAT Kamal stacks DELETE_COMPLETE; all six application EC2 instances terminated and their 240 GiB root volumes deleted. Retain policies leave ECR, AgentCore, signing keys and logs for explicit cleanup after backup. Six legacy ECS Express service deletion requests accepted.
- Application persistent data is in the verified DB/S3 package. Dev volume contains isolated synthetic fixtures per rehearsal receipt; it is being attached read-only to the backup bastion to preserve useful contents before deletion. Shared bastion started only for supplemental offline backup.
- Additional S3 inventory: AgentCore 200 versions / 205636244 bytes; CloudTrail 53132 versions / 418418758 bytes; local bucket empty. Supplemental downloads and CloudWatch exports underway.
- All exact mutation receipts are recorded privately in retirement/actions.jsonl. Never treat accepted deletion as final absence; remaining verification is required. UAT/READY/Production run IDs NOT_DISPATCHED.

## Retirement completion and supplemental delivery

- Final cloud verification: 2026-10-07T03:26:14.985797Z; 42 checks pass with zero active/storage resources. 49 secrets are scheduled and all four customer KMS keys are PendingDeletion. No billable resource residue found in the checks; costs already accrued are not reversed.
- Supplemental archive: `/Users/thawatchai/Downloads/mangmeeplus-retirement-supplement-20261007.tar.gz`, 884725809 bytes, mode0600. SHA256 `fcb78072b591ddc2e4938477e7e2c6036f407a1289850a5fc9e0b634b286b10a`. Adjacent `.sha256` retained.
- All 107580 supplemental payload files were read from the finished archive and matched SHA256SUMS at 2026-10-07T03:28:19.684066Z. Includes 53688 additional S3 versions, Dev state, RDBs, Official OA ZIP, logs/configuration and private credentials. The original 573721632-byte archive remains unchanged.
- ECR image inventories and source/configuration retained for rebuilding; generated container layers, application EC2 disk images and original non-exportable KMS private keys are not in the offline package. Dev selected filesystem state is preserved, not a bootable disk image.
- All temporary cloud export objects/bucket policies disappeared with the five deleted buckets. Backup bastion terminated; its disk removed. Local Redis verification used disposable `--rm --network none --read-only` containers. No local user containers/volumes modified.
- Five original CloudFormation stack readbacks are DELETE_COMPLETE. Historical task sections above describe intermediate states and do not supersede this completion readback.
- Documentation `git diff --check` passes. Preserve unrelated dirty files; no commit/push or release run was performed.

## Follow-up: external services and AWS cost confirmation

- Read-only AWS recheck at 2026-10-07T10:36:50.494308+07:00: all 42 resource checks still zero; 49 secrets scheduled and four customer KMS keys PendingDeletion. Original archive/source verification files were not overwritten; follow-up evidence is `followup-cloud-verification-20261007.json`.
- Repository/runtime configuration and preserved records identify external Cloudflare DNS/Workers, mangmeeplus.com domain registration, Google-hosted domain email, LINE OA/Login/LIFF, Postmark, Stripe, Typhoon OCR and GitHub/Actions. Fresh public DNS confirms Cloudflare nameservers and Google mail exchangers. This is an integration inventory, not proof that every provider has an active paid plan.
- No external billing dashboard or subscription status was inspected, and no external service was cancelled. Historical Postmark observation (September12) showed a100-email allowance; current paid/free status is unverified. Stripe customer subscriptions, if active, are managed by Stripe and do not cancel when AWS is removed.
- Recurring AWS infrastructure is retired; already accrued costs and any new future API/resource usage are distinct from the removed footprint. No claim of a zero final invoice.
