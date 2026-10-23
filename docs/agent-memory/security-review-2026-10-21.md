# Agent Memory: security-review-2026-10-21

Status: Complete — assessment/report and user-authorized thawatchai follow-up delivered; remediation not performed
Owner: Codex
Scope: Security assessment of current working tree and deployed source, production dependency audit, focused local security regression tests, live AWS/container/process configuration, and bounded anonymous HTTP checks. No application changes, deployment, account/data mutation, or intrusive production testing. Four anonymous 1–2 byte negative POSTs verified parser/auth ordering without model invocation.
Decisions:
- Preserve all pre-existing dirty/untracked work. Baseline HEAD: `4a5817b42`; findings apply to the working tree unless explicitly marked live.
- Use repository security specs/checklist as context; independently distinguish verified findings from historical closure gaps.
- Save only sanitized evidence; never include credentials, token/cookie values, or customer payloads.
- Read cloud-environment-operations.md before any live inspection. UAT is documented paused; do not start it.
- User explicitly requested real code and real configuration; initial read covered all four running Production containers through enrolled SSM/SSH transport and existing non-root profiles. Follow-up root-profile reads were explicitly authorized by the user; no IAM changes.
- Live source is `29b1eab65fe852db0abcd7b2f69d45d64a1ae540`, distinct from the working tree. Saved deployed excerpts and verified lockfile equality; read package versions in the final running filesystem.
- Applied Ponytail full using the current repository skill path because the absolute `/Users/spare058/...` path is stale. Reused existing transport and tests; no dependency/install/application-code edits.
Open questions: No question blocks delivery. Previously denied Redis/S3/RDS-parameter/ALB-WAF metadata is now verified using user-authorized thawatchai. Cloudflare rules, authenticated tenant E2E, complete IAM/image/secret-history, restore testing and incident analysis remain out of scope.
Artifacts:
- `docs/research/security-review-2026-10-21-th.md`
- `docs/evidence/security-review-2026-10-21/`
- Added a scoped current security readback to `docs/runbooks/cloud-environment-operations.md`, preserving prior changes.
Verification:
- API 191/191, AI 34/34, web 19/19 = 244/244 focused tests passed; 0 skipped. Initial root-cwd decorator transform failures are retained and superseded by correct per-package-cwd invocations; no code changed for tests.
- `corepack pnpm audit --prod --json`: exit 1; 528 dependency graph; 40 advisories (Critical 2 / High 12 / Moderate 24 / Low 2). Distinguish graph advisories from proven reachability; Critical exploit prerequisites not found in reviewed source/config.
- Live settings, HTTP responses, package versions, deployment SHA, log groups, RDS and security groups saved as sanitized JSON; no customer/credential values saved.
- API and AI compiled production-config validation passed. First package collector's API validation status was overwritten by a missing web config module; final targeted API evidence resolves it. API process has delegation key; Next process does not.
- Four anonymous tiny POSTs: valid empty JSON 401 vs malformed JSON 400 on two internal AI endpoints; proves pre-auth parsing without load test.
- Seven owned SSM transports terminated 7/7 across three bounded read batches. UAT/READY/PROD run IDs NOT_DISPATCHED.
- High-confidence secret-pattern scan: 5457 tracked text files, 2 test-only matches, 0 confirmed live secret matches; not a full history/entropy scan.
- Report local links and all evidence JSON parse successfully.
Next: Address SEC-01/02 first, then container hardening, company-name disclosure and log-key policy. Follow ordinary spec/plan/release protocol for remediation; do not mark system-wide security checklist closed from this bounded audit.

## Follow-up — authorized thawatchai profile

User explicitly authorized using `thawatchai` to read missing settings. STS identifies this profile as `arn:aws:iam::311414082667:root`, same account. Completed configuration/metadata reads at 14:14–14:15 Asia/Bangkok for Redis, the runtime S3 bucket, ALB/WAF and the previously denied RDS parameter; no IAM/service/customer-data mutation. Earlier non-root AccessDenied evidence remains preserved.

- Redis encryption at rest, required TLS, auth, automatic failover, MultiAZ and 35-day retention verified. Two nodes in different AZs; 12 available automated snapshots on replica `-002`, latest 2026-10-21 04:23 Bangkok. Group-only snapshot listing returned empty; per-member reads resolved this without a false backup-gap finding. No restore test.
- Runtime S3 bucket has all four public-access blocks, BucketOwnerEnforced, owner-only ACL, AES256/SSE-S3 and versioning enabled. Account block configuration and bucket policy do not exist (NoSuch, not AccessDenied); record account guardrail/HTTPS bucket-policy gap without claiming public data or observed plaintext traffic.
- WAF `WebACL=null` on current Production ALB; listener host routes bind both API/AI origins to it. This strengthens SEC-01; Cloudflare remains unreviewed. Initial collector JSON decode error from empty successful CLI output was corrected with explicit WebACL projection and documented.
- `rds.force_ssl=1`; attached group in-sync, instance pending changes empty. Parameter ApplyMethod=pending-reboot is metadata, not proof of a current reboot requirement. SQL effective value not queried.
- Three new JSON files contain 18 recorded metadata requests; 15 return success, 3 confirm absent S3 configurations. All 25 evidence JSON files parse; report/README links resolve. Existing 244 tests were not rerun because this follow-up changes documentation/evidence only.
- Report, evidence README and cloud operations runbook updated. No additional SSM session, deployment or UAT start; run IDs remain NOT_DISPATCHED.
