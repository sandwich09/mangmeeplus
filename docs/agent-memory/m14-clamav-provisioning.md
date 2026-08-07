# Agent Memory: M-14 ClamAV provisioning and isolated scanner evidence

Status: UAT live closure is COMPLETE. The final image runs clamd/freshclam as non-root, and the
compiled production scanner detects EICAR through `127.0.0.1:3310`. GitHub UAT has
`CLAMAV_HOST=127.0.0.1`; live clean activation, EICAR quarantine, HIGH-risk audit, blocked
quarantine download, correlated structured logging, and CloudWatch `ALARM` state all passed.
Production promotion is explicitly SKIPPED until the prerequisites below are satisfied. No AWS
resource was created for the superseded external-service option.
Owner: This task. Continues `prod-required-keys-webhook-deny-all.md`, whose recorded "Next"
was "Release owner: provision the ClamAV service, then set `CLAMAV_HOST`". M-14 itself belongs to
Codex `/root` (`p1-security-remediation-m04-m18.md`).

Scope:
- Run co-located ClamAV for API tasks on loopback 3310, configure UAT, produce scanner evidence,
  and preserve the prerequisites for a later production promotion.

## Decisions

- Evidence drives the SHIPPED code, not a re-implementation: `scripts/m14-scanner-evidence.ts`
  imports the real `inspectAttachmentBytes` and the real `AttachmentMalwareScanner`, so the
  INSTREAM wire protocol under test is the one `CompleteAttachmentUploadUseCase` calls.
- `CLAMAV_HOST` stays unset until a scanner actually answers on 3310. Setting it early would
  turn a blocked deploy into broken uploads: `assertClean` fails closed at TCP-connect, so a
  host that resolves to nothing is strictly worse than no host at all.
- The owner later selected the shortest deployable option: clamd is co-located in the api-web
  image and `CLAMAV_HOST=127.0.0.1`. This supersedes the earlier separate-Fargate/NLB decision.
  The variable must still be set only after the matching image is published.
- Owner decision 2026-07-28: proceed with UAT readiness and skip production. Do not set or deploy
  production merely because UAT becomes green.
- Recorded as evidence rather than "fixed": ClamAV does NOT detect EICAR embedded inside a
  PDF/PNG/JPEG container. EICAR is a whole-file signature (68 bytes plus at most trailing
  whitespace) and ClamAV declines substring matches on purpose. Verified independently of our
  client with `clamdscan` in the container: `raw.txt: Eicar-Test-Signature FOUND` vs
  `in.pdf: OK`. The `inspectAttachmentBytes` EICAR check is what stops the wrapped payload, so
  the two layers are complementary — this is the reason that check must not be removed as
  "redundant with the AV scanner".

## Architecture (latest owner decision 2026-07-28)

ClamAV is co-located in the existing api-web container:

```
AttachmentMalwareScanner -> 127.0.0.1:3310 -> clamd
                                             freshclam (12 checks/day)
```

- `infra/api-web/Dockerfile.api-web` installs the official ClamAV 1.5.3 x86_64 package pinned by
  SHA-256 and bakes a current signature database into the immutable image, so startup does not
  depend on a successful first download. Debian's 1.4.3 was rejected because it predates the
  security fixes in 1.4.5/1.5.3.
- Both daemons run as `node`. No Unix socket is configured; clamd listens only on container
  loopback and is not exposed by the ECS service.
- Startup waits for a PONG before starting API/web/proxy. A stale database older than seven days,
  a dead daemon, or a dead updater makes the container fail and restart rather than bypassing AV.
- ClamAV processes launch from an allowlisted empty environment so they do not inherit application
  secrets.
- The combined api-web task is raised from 1 vCPU/2 GB to 2 vCPU/6 GB for clamd signature memory
  and update/reload headroom.
- The verified local amd64 image is 473,679,069 bytes, below the earlier unmeasured ~1 GB estimate.

## Superseded external-service option and IAM blocker

A separate Fargate scanner behind an internal NLB was evaluated first, but neither available
identity can create the required load-balancer resources. Nothing was provisioned. ECS Express
Mode cannot host a raw-TCP ClamAV service because it exposes one primary HTTP/HTTPS container.
The selected co-located implementation needs no new AWS network/IAM resources and supersedes
that option.

## Artifacts

- `scripts/m14-scanner-evidence.ts` — the corpus; `pnpm security:m14-evidence`
- `package.json` — `security:m14-evidence` script
- `docs/security-evidence/m14-upload-scanner-isolated-corpus.md` — recorded run
- `docs/security-evidence/m14-uat-live-upload-evidence.md` — sanitized UAT upload/database/audit/alarm evidence
- `infra/api-web/Dockerfile.api-web` — installs and configures the loopback-only scanner
- `infra/api-web/start-api-web-runtime.sh` — fail-closed readiness and daemon supervision
- `infra/prod-ecs-express/deploy.sh` — 2 vCPU/6 GB api-web resources
- `infra/docker/production-image-security.spec.sh` — static co-location assertions

## Verification

Isolated environment: `clamav/clamav:stable` (ClamAV 1.5.3, signature DB 28058 dated
2026-07-12) in local Docker, `CLAMAV_NO_FRESHCLAMD=true`, published only on
`127.0.0.1:13310`. No production connectivity, no S3, no production database.

`CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=13310 pnpm security:m14-evidence` → **28/28 PASS**, covering:
- META 6/6 — MIME allowlist (SVG/HTML/Office refused), 25 MB bound, zero-byte refusal
- CONTENT 13/13 — magic-byte mismatch, JPEG+`<script>` polyglot, SVG smuggled into a real PNG,
  `javascript:` URI, `/OpenAction`+`/JavaScript`, `/Launch`, `/EmbeddedFile`, 100k-object PDF
  parser bomb, truncated JPEG without EOI
- AV 9/9 — clean PDF/PNG/JPEG scan CLEAN, a 5.1 MB PDF scans CLEAN through ~80 INSTREAM chunks
  (proves the 64 KB chunk-framing loop), raw EICAR and EICAR+whitespace are `MALWARE_DETECTED`,
  the three container cases document the clamd whole-file-signature boundary above, and an
  unreachable scanner fails closed rather than reading CLEAN

Co-located production-image verification (local amd64 build, 2026-07-28):
- `docker build --platform linux/amd64 --target runner -f infra/api-web/Dockerfile.api-web ...`
  passed; final image config is `USER node`, and `clamscan --version` reports 1.5.3.
- `verify-production-image.sh` passed the filesystem allowlist.
- clamd stayed healthy as `node`; the compiled production `AttachmentMalwareScanner` returned
  CLEAN for a small clean body and a 5 MB multi-chunk body, and `MALWARE_DETECTED` for raw EICAR.
- freshclam one-shot notify and the foreground daemon command both ran as `node`; databases were
  daily 28075, main 63, bytecode 339.
- shell syntax, production image static checks, and `git diff --check` passed. The Sonnet
  assertion was updated to the current `PROD_CHAT_MODEL` name and still proves production is
  pinned to Sonnet 4.6.
- `pnpm --filter @watchdog-bms/api test:p1` passed 22/22, including scanner fail-closed,
  explicit-clean, and malware-verdict tests.
- The CI-equivalent sequence (`contracts` build, Prisma generate, then workspace typecheck)
  passes locally with `NODE_OPTIONS=--max-old-space-size=4096`.
- GitHub CI run `30357012080` confirmed the raised-heap typecheck, full workspace tests, M-01,
  P1, every production image build, filesystem verification, and SBOM generation pass. Its only
  failure was the API boot smoke test on a fresh runner because `@watchdog-bms/config/dist` had not
  been built.
- `test:boot` now builds `@watchdog-bms/config` before the API artifact; the focused local rerun
  passed (`boot-di-smoke: Nest resolved every provider`).
- UAT deploy run `30363523407` for `bbf69f2d` passed config, tests, P1, image builds, and local
  SBOM checks, then stopped before deployment because the ECR registry produced no scan for the
  pushed workers digest. The shared gate suppressed the AWS error and timed out after five
  minutes. It now starts a basic scan only on `ScanNotFoundException`, reports permission/API
  errors immediately, still fails closed, and keeps rejecting any HIGH or CRITICAL finding.
- The updated least-privilege inline policy was applied successfully to `watchdog-bms-ci-uat` on
  2026-07-28; production IAM and runtime were not changed.
- UAT retry `30367908479` exposed one more compatibility rule: max-mode provenance publishes an OCI
  index, while ECR basic scanning accepts the runnable image manifest rather than that index. The
  gate now scans the single `linux/amd64` child digest and keeps the signed/provenance-bearing index
  digest as the immutable deployment artifact.
- The resolved workers manifest then failed closed with 3 Critical and 5 High findings, all from
  unused Perl `5.36.0-7+deb12u3` and with no fixed Bookworm package reported by ECR. The three
  published runtime stages now remove Perl after build/runtime package setup; build stages retain
  their tooling.
- UAT run `30370117802` passed the ECR gate, signing, SBOM, and digest manifest for all three
  images, then stopped before rollout because the deploy role could verify the API signature but
  lacked ECR read access for the AI Gateway signature. The UAT deploy policy now grants only
  `BatchGetImage`/`GetDownloadUrlForLayer` across the three release repositories; release-task push
  remains scoped to the API repository.
- After applying that narrowed UAT policy, run `30370117802` attempt 2 passed signature verification,
  release task, UAT/all rollout, active-digest verification, and health verification for source
  `f72eb8fa`. Production IAM and runtime remained untouched.
- Live UAT upload run on 2026-07-28 used isolated tenant
  `cms4t8phj00051n5qw3atytaj`. A clean PDF completed `ACTIVE` and its protected download route
  returned `200`. EICAR-in-PDF attachment `cms4t8tdb00111n5qasz9kiio` was rejected with `400`
  (`Malware test signature detected.`), its download route returned `403`, and the company audit
  API returned one correlated `attachment.upload.rejected` row with `FAILED`/`HIGH` and request ID
  `m14-live-eicar-20260728152814-complete`.
- That run also found the live alarm gap: no correlated structured CloudWatch log existed,
  GitHub UAT had no `SECURITY_ALERT_TOPIC_ARN`, and CloudWatch had no M-14/general security alarm
  for the api-web log group. The rejection use case now emits the stable
  `attachment.upload.rejected`/`HIGH` event, and `infra/uat/m14-upload-alert.sh` installs and
  verifies a UAT-only metric alarm without routing test alerts to production.
- Focused upload/security-event tests pass 18/18; the production-image security script, M-14
  alert shell syntax, event-file identity guard, and `git diff --check` pass. `actionlint` is not
  installed locally, so the workflow YAML remains subject to the repository CI validation.
- UAT api-web run `30377065243` deployed source
  `b3a159380af806cb566c8c871181f2796c5d8004`; tests, security/image/ECR/signing/SBOM gates,
  release task, rollout, active-digest verification, and health verification passed. SSM readback
  returned `b3a159380af8`.
- Final live EICAR request `m14-live-eicar-20260728163133-complete` produced completion `400`,
  download `403`, a correlated `attachment.upload.rejected` audit row with `FAILED`/`HIGH`, and
  one structured CloudWatch rejection log. The UAT alarm
  `watchdog-bms-uat-m14-attachment-upload-rejected` transitioned `OK → ALARM` at
  `2026-07-28T23:32:07+07:00`, then returned to `OK` after the non-breaching period.
- Read-only ECS task `21572d4eeb7a45648494e1c9360a70cf` exited `0` and confirmed clean
  attachment `cms4t8r0o000x1n5qcg7555fa` is `ACTIVE` with provider version/checksum/upload time,
  while EICAR attachment `cms4vi4tj000n1e5szdrusi52` is `QUARANTINED` without those activation
  fields. The two preceding diagnostic tasks also made no mutations and failed only because their
  ad-hoc query referenced the wrong Prisma runtime path.

UAT alarm-state evidence is complete. Human notification delivery is not claimed because UAT has
no `SECURITY_ALERT_TOPIC_ARN` and the UAT-only alarm has no actions. M-14 therefore stays open only
for production promotion and notification-delivery closure.

## Production promotion prerequisites — persistent reminder

Do not promote to production until every item below is true:

- the exact ClamAV commit is merged to `main`, selected by an approved production release ref,
  and all CI, immutable-image, SBOM, ECR scan, signature, and digest-manifest gates are green;
- the production image-publisher role grants `ecr:DescribeImageScanFindings` and
  `ecr:StartImageScan` on the three release repositories before the shared gate is used;
- the production scan gate resolves the runnable `linux/amd64` child manifest from the
  provenance-bearing OCI index and passes the ECR HIGH/CRITICAL policy;
- UAT runs that exact code/digest with `CLAMAV_HOST=127.0.0.1`, and live evidence confirms clamd
  readiness, clean upload activation, EICAR quarantine, HIGH-risk rejection audit, alarm delivery,
  and no ACTIVE object for rejected bytes;
- production GitHub `CLAMAV_HOST=127.0.0.1` is set only immediately before promoting that matching
  image;
- production `LOG_KMS_KEY_ID` remains valid, `SECURITY_ALERT_TOPIC_ARN` exists and delivers to the
  named on-call owner, and a synthetic alarm has been acknowledged;
- `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` points to real DPO/legal evidence recorded in the
  processor/lawful-basis register for the production Sonnet 4.6 global profile;
- rollback is ready: disable upload completion and preserve quarantined objects; never bypass the
  scanner or mark unverified bytes ACTIVE.

## Next

1. Keep production skipped until every prerequisite above is satisfied and the owner explicitly
   authorizes promotion.
2. Configure the owned production `SECURITY_ALERT_TOPIC_ARN`, prove synthetic delivery and
   acknowledgement, then repeat clean/EICAR/quarantine/audit/alarm verification on the approved
   immutable production release.
