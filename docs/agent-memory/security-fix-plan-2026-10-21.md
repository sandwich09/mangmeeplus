# Agent Memory: security-fix-plan-2026-10-21

Status: PLANNED, nothing changed. Owner 2026-10-21 afternoon: "บันทึกไว้ก่อน ยังไม่ทำอะไรเดี๋ยวจะทำตอนกลางคืน".
Update 2026-10-21 ~15:20: owner had SEC-04 (company name) and SEC-02 (dependencies) done first via
Codex — LANDED on develop `cb9f3cfe8` and main `6ad1f3677` (same tree), NOT deployed. `pnpm audit --prod`
= 0; sharp 0.35.5/librsvg 2.63.2 renders of the 3 documents pixel-identical; Dockerfile native pins now
sharp-linux-x64 0.35.5 / sharp-libvips-linux-x64 1.3.4. Not run locally: Docker image build (first
proven at the next release prepare), web full suite, real-PG, journeys. Drop those two items from step (2).
Pins follow-up: `sync-production-maintenance-release-pins.mjs --check` was already stale on develop
(create-download-url pin from 3d16e9f59) and the Dockerfile/auth-guard edits added to it; re-synced and
landed develop `50ac3a6ce` / main `84940a046` (same tree).
Local impact proof on 50ac3a6ce (owner: "ลองบน local ... ตรวจทุกจุด"): prove.sh suites 25,809 green,
real-DB 534 green, journeys 87/88 then 88/88 (the one miss = the known first-visit wait on บันทึกด้วยมือ,
also seen 10-15 and 10-19 on old code). Old-vs-new A/B (same inputs): receipt preprocessing (EXIF-6
phone photo, PNG, 2-page and big scanned PDF) and signature normalisation byte-identical; real
substitute receipt, voucher, 50 ทวิ and ภ.ง.ด.53 PDFs from the proof API look right. Headless sweep of
33 sold screens × 1556/390 on old and new: same headings, no overflow, warm median 445→453 ms; old dev
CSP chunk warnings gone; new dev-only React `performance.measure` pageerror on settings/roles and
settings/security (production React has no measure calls). Proof stack left on pv-b (old code) as found.
Local docker containers pv-a-pg/pvtry-* had been stopped at 11:58; restarted them.
## Night round 2026-10-21 (owner: "ทำ 1 2 3 4 5 ได้เลย ส่วนเรื่องอื่นให้บันทึกไว้ก่อน")

DONE (live, owner reviewed every change set before execution):
- Item 2 AI ingress: Production stack change sets `ai-ingress-20261021-prod-stage` (2 Add EIP: ApiA
  13.228.157.253, ApiB 18.139.177.255) and `ai-ingress-20261021-prod-active` (Modify AiStagingRoute +
  source-ip those two /32, no replacement). Outsiders on ai-origin now get the ALB default fixed
  response 503; both API hosts reach ai-origin (health 200, internal no-secret 401); all targets
  healthy. Private templates/scripts: `~/.codex/edge-operations/20261021-ai-ingress/`.
  Rollback: change set back to the stage template (removes only the source-ip condition).
- Item 1 MFA: deploy user `watchdog-bedrock-dev` had DIRECT prod powers (secrets read/write, SSM to
  all instances incl. port-forward, ECR push, AgentCore update, IAM create-role). Owner registered MFA
  device `mfa/watchdog-bedrock-dev-laptop`. Group `mangmee-require-mfa` + managed policy
  `mangmee-require-mfa-except-read-and-models` (inline was over the 2 KB user limit; user already at
  10 managed policies) denies everything except read-only ops (logs/metrics/cost/describe) and Bedrock
  model calls unless MFA is present. Deploy role change set `deploy-role-mfa-20261021`: trust requires
  MFA, MaxSessionDuration 28800. `~/.aws/config`: production profile mfa_serial + 8 h, UAT profile
  mfa_serial + 1 h (backup `~/.aws/config.bak-20261021-mfa`). Owner typed the code once; the CLI cache
  serves release tooling non-interactively (verified `configure export-credentials`).
  Old unused key `...EXE7` (created 2026-06-26, last used 2026-08-04 ECS) set INACTIVE.
- Items 3/4/5 code landed develop `f4b019564` / main `9732cb57a` (same tree), NOT deployed:
  AI gateway internal-secret check before body parsers; AI side no longer needs/receives the JWT key
  (config, AgentCore runtime, release tooling strips it, refuses to reuse a runtime still carrying
  it); `cap-drop ALL` + `no-new-privileges` for every app container (proved on real images). Pins
  re-synced; W00 manifest refreshed; suites green, whole-chain 1316/1316, release_test OK, AgentCore
  artifact /ping OK.

- UAT LIVE 2026-10-21 23:47 (owner: "เอาขึ้น uat เลยและทดสอบ"): Kamal operation
  `20261021T164111Z-4f75a728` (prepare `20261021T163219Z-6d53fe1c`), main `9732cb57a`, signed,
  ACCEPTED_LINE_DEFERRED; AgentCore UAT `kamal_uat_b` v24. UAT deploy role also got MFA + 8 h
  (change set `uat-deploy-role-mfa-20261021`; profile `duration_seconds` 28800). Verified on UAT:
  anonymous internal → 401 before parsing; API→AI with key 200 / without 401 / 5 MB body OK; all app
  containers CapDrop ALL + no-new-privileges (CapEff 0); AI container and AgentCore env have no JWT
  secret key; logs clean. Signed-in walk 2026-10-22 ~00:20 (owner logged in, controller tested):
  company-name 403 hides the name; 23 screens wide + 11 phone OK; voucher PDF and substitute preview
  render right; receipt OCR via API→AI correct in 7 s. Owner LINE chat "คุยแล้วตอบปกติ"; AI log
  confirms receipt read + accounting/advisor turns completed. UAT fully accepted.
- PRODUCTION LIVE 2026-10-22 00:26 (owner: "เอาขึ้น Production ได้เลย"): operation
  `20261021T171504Z-6f47b232` from that UAT run, main `9732cb57a`, signed ACCEPTED_LINE_DEFERRED 665.8 s;
  AgentCore `kamal_production_a` v9 without the JWT secret key. Items 3–5 verified on all four hosts
  (see runbook). Remaining from step (3): rotate `watchdog-jwt-secret` (every web user logs in once),
  then remove AgentRole access to it by a reviewed change set — owner 2026-10-22 00:35: "ยังไม่เปลี่ยน
  กุญแจตอนนี้ บันทึกไว้ก่อน เดี๋ยวบอกอีกที" → PARKED; do not start until he says so.
  Asked again at 00:40 for the time (answered ~30–40 min) and said "ยังไม่ทำ บันทึกไว้ก่อน". Plan when he
  says go: (a) owner runs ONE Terminal command that puts a random new AWSCURRENT version of the
  production `watchdog-jwt-secret` (value never shown; running containers keep the old value until
  redeploy, so nobody is logged out yet); (b) `promote-prod --prepare` then `--apply` again from the
  signed UAT run (UAT receipt valid 24 h; else a fresh UAT run first) so the release recaptures the
  new secret version — rotate BEFORE the prepare or config freshness stops it; owner signs in for
  browser acceptance; every web user logs in once, LINE unaffected; (c) reviewed change set removing
  the JWT secret ARN from AgentRole `ReadExactInternalToolSecret` (keep the internal-tool secret).
  Check first that no other consumer (e.g. the Official OA Lambda) verifies tokens with this secret.
- 2026-10-22 ~00:50 owner: "เปลี่ยน key ได้เลย … theme เทศกาล … เอาขึ้นไปด้วยปกติได้เลย". Round = main
  `733f77864` (theme #1147/#1148 + pin re-sync; develop `5b3d3acf7` same tree; one new table migration).
  Only api-web consumes the key (Official OA Lambda, workers, AgentCore v9 do not). Deploy roles can
  only READ secrets, so the owner writes the new versions with his own `thawatchai` login profile.
  Before rotation: UAT AWSCURRENT `67535a6e…`, Production AWSCURRENT `3c66927d…` (AWSPREVIOUS `13376f76…`).
  ROTATED by the owner ~01:00: UAT AWSCURRENT `5c03269b…` (previous `67535a6e…`), Production AWSCURRENT
  `cb28aea5…` (previous `3c66927d…`). The owner then re-ran both commands (I had posted them twice):
  final UAT AWSCURRENT `7a417044…` (previous `5c03269b…`), Production AWSCURRENT `3b81cdcf…` (previous
  `cb28aea5…`); the serving Production value `3c66927d…` no longer has a stage (containers keep it in
  env until the next release). Lesson: post an owner command once, never repeat it in a follow-up.
  Running containers keep the old value until the next release.
  AgentRole change set drafted (not created): `~/.codex/edge-operations/20261022-agentrole-jwt/`
  (one Modify AgentRole, Policies only; AiRole has no secrets access).
- DONE 2026-10-22 ~01:10: UAT `20261021T174744Z-087f4a5c` and Production `20261021T175544Z-f4f52630` (main
  `733f77864` incl. the festival theme) both signed and live on the new keys; every old web session
  rejected. The AgentRole change set was deleted unexecuted (it cascaded into AgentRuntime + both
  endpoints). Done instead: resource-policy DENY on the Production key for the AgentRole (owner said
  "ใส่เลย"). Step (3) of the plan is complete. UAT key has no deny yet (UAT AgentRole still may read
  the UAT key) — record only. Production homepage theme = default; UAT = halloween.
- Owner 2026-10-22 ~01:20: switched the Production homepage to Halloween himself ("ลองแล้วผ่าน"); sent a
  LINE message on Production ("ลองแล้วผ่าน"); UAT key deny "ไม่ต้องทำ" (closed, not a follow-up); the
  rest stays recorded: laptop key rotation ~2026-11-04, UAT ai-origin allow-list, ALB 503 text, legacy
  deploy-user policies, SEC-03 step 2, SEC-05, S3 guardrails, WAF, API alarm cause.

NEXT / RECORDED (not done, owner said record only):
- Every Production/UAT AWS operation now needs the owner's 6-digit code first (session 8 h prod / 1 h
  UAT). Plan releases while the owner is present.
- Next release (UAT first) carries items 3–5. After it is live: rotate `watchdog-jwt-secret` at night
  (every web user logs in once), then remove AgentRole `ReadExactInternalToolSecret` access to the JWT
  secret via a reviewed change set, and confirm the AI container env no longer has the key.
- Rotate the laptop key `...7DOT` after deleting the inactive `...EXE7` (2-key limit), ~2026-11-04.
- UAT ai-origin has the same open ingress; apply the same EIP + source-ip pattern to the UAT stack (recorded, owner 2026-10-22).
- ALB default fixed response still says "Production restoration in progress" (cosmetic).
- Clean up the deploy user's legacy App Runner / ECS Express direct policies.
- SEC-03 step 2 (read-only root FS), SEC-05 log CMK (recommend accept default + amend runbook),
  S3 account public-access block + HTTPS-only bucket policy, WAF (not needed now), API security alarm
  root cause.

Local release build (`infra/dev-kamal/build-complete.py`, no deploy/push) of 50ac3a6ce passed every
phase: typecheck, DI, AgentCore artifact, api-web/ai-gateway/workers/tools images (linux/amd64); the
in-image api-runtime smoke (sharp SVG/signature + pdf.js/canvas render) and the ai-gateway receipt
orientation check ran (not cached) with sharp-linux-x64 0.35.5 / libvips 1.3.4. Not done locally: ECR
image scan (runs at publish).
Owner: platform (owner approves every AWS change and every Production promotion).
Scope: fixes from the 2026-10-21 security report and its independent verification.

Source docs (both untracked, not committed):
- Report: `docs/research/security-review-2026-10-21-th.md`
- Verification + impact table: `docs/research/security-review-2026-10-21-verification-th.md`

Verified facts (Production = source `29b1eab65`; origin/main differs only by a Cloudflare worker commit):
- SEC-01..05 all confirmed. Root account MFA is ON (owner confirmed 2026-10-21).
- NEW-B (high): `mangmee-kamal-production-deployrole` trusts IAM user `watchdog-bedrock-dev`
  (long-lived key in `~/.aws/credentials`) with no MFA condition; role reads all
  `watchdog-bms/production/*` secrets, pushes ECR, updates AgentCore, starts SSM. Role has no
  `MaxSessionDuration` (1 h default).
- NEW-A (medium): HS256 user-token key is in the AI container and readable by AgentRole; no AI route
  verifies user tokens (all `@Public` + internal secret). API still requires an ACTIVE session row.
- API reaches AI via public `ai-origin`; both origins resolve straight to the ALB (no Cloudflare).
  Hosts have auto-assigned public IPs (no EIP).

Decisions:
- Order: (1) AWS-only: MFA on deploy-role trust + `MaxSessionDuration` 28800 + profile
  `mfa_serial`/`duration_seconds`, rotate the IAM user key; EIPs for both API hosts, then ALB
  `AiStagingRoute` source-ip = those EIPs. (2) next release via UAT→Prod: auth before body parser,
  drop the AI production JWT-key requirement (`packages/config/src/index.ts` ~917 + its test),
  dependency updates (sharp+libvips pins in 3 Dockerfiles, Next 16.3.8, remove axios, bump multer
  override), company-name 403 fix, cap-drop ALL + no-new-privileges. (3) after that release, at
  night: rotate the JWT secret (every web user logs in once), then remove AgentRole secret read and
  AI env. (4) later: read-only root FS.
- Recommended, NOT yet owner-decided: skip log CMK (amend runbook to accept default encryption).
  WAF not needed once ai-origin is IP-restricted.

Hazards:
- Stack changes go through `prepare-production-stack.py` + owner/root stack update; review the
  change set: no instance replacement.
- Removing AgentRole secret access before the runtime code change stops LINE AI.
- MFA session shorter than the longest release can stall a release mid-way.
- Log CMK without writer KMS grants blocks the awslogs driver (blocking mode) and can hang apps.
- librsvg upgrade: visually check substitute receipt, 50 ทวิ, ภ.ง.ด.53 on UAT.

Open questions: owner decision on log CMK; check for intentionally public S3 buckets before an
account-level public-access block.
Artifacts: the two docs above; runbook note in `docs/runbooks/cloud-environment-operations.md`
(2026-10-21 security section, uncommitted).
Verification: read-only only (code at deployed SHA, deployed CloudFormation template via deploy
profile, non-root AWS reads, 6 anonymous HTTP probes). No tests re-run.
Next: tonight, start step (1) only after owner says go; follow
`docs/runbooks/uat-production-v2-deployment.md` for step (2).

## Node.js report 2026-10-22 (verified by me, nothing changed)
Report: `docs/research/nodejs-security-review-2026-10-22-th.md` (+ evidence dir, untracked, other session).
Verified: all six Dockerfiles (api, ai-gateway, workers, web, web lambda, combined api-web; tools image
builds from them) pin `node:22-trixie-slim@sha256:c5849ff9…` = Node v22.23.2, Brotli 1.1.0, OpenSSL
3.5.7, Undici 6.28.0 (ran it locally). Upstream 2026-10-21 security release fixes 22.x in v22.23.4
(CVE-2026-111497 Brotli OOB write/RCE High; CVE-2026-105482 DNS NUL High; CVE-2026-106069 TLS
hostname High; plus Medium/Low). Docker Hub: `node:22.23.4-trixie-slim` = `22-trixie-slim` =
`sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf` (pushed 2026-10-21 17:38Z).
API `apps/api/src/main.ts` json/urlencoded parsers (body-parser 2.3.0, inflate default true) decode
`Content-Encoding: br` before any guard → anonymous internet reachable via Cloudflare/ALB. AI gateway:
secret check runs before its parsers + ai-origin allow-list. No caller sends compressed request bodies
(grep), so `inflate:false` on the API parsers is a safe extra guard. Managed runtimes: AgentCore
`NODE_22` and Official OA Lambda `nodejs24.x` are AWS-patched (not checked). Fix = bump the six
digests + pin re-sync + read `process.version` in built images, then UAT (currently paused by the
owner) → Production.
Owner 2026-10-22: "บันทึกไว้ก่อน ยังไม่แก้" → Node 22.23.4 bump + API `inflate:false` PARKED; start only on
his word (estimate ~45 min incl. starting the paused UAT and a Production sign-in).
Owner 2026-10-22 evening: "ตรวจดูผลกระทบก่อน" → impact check (no push, no deploy). Local branch
`claude/node-22.23.4-impact` = `10e3d6747` in worktree `mangmee-worktrees/node2234-impact` (6 digests →
`node:22.23.4-trixie-slim@sha256:8eb619e4…`, API parsers + provider-events `inflate:false`, pins re-synced).
Results so far: 22.23.3+22.23.4 changelog = OpenSSL 3.5.9, Undici 6.29.1, c-ares 1.34.9, NSS 3.131.1 roots,
TLS non-canonical-IP/IPv6-SAN/blocked-key checks, http agent guard, Brotli cherry-pick; ABI 127 unchanged.
Outbound TLS+fetch to 20 provider hosts identical on 22.23.2 vs 22.23.4 (LINE, Stripe, Postmark, AWS, FX,
own origins). Express probe: plain/identity JSON unchanged; br/gzip → 415 `encoding.unsupported`.
`build-complete.py` PASSED (typecheck, DI, AgentCore, 4 images; in-image Thai-font, api-runtime PDF/
preview/bank/capture/signature, AI orientation checks ran uncached); all 4 images report v22.23.4,
OpenSSL 3.5.9, Undici 6.29.1, BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH present; ClamAV 1.5.4 OK.
prove.sh on host Node 22.23.4 (official darwin tarball, SHA256 verified, in scratchpad) started 19:13;
proof stack stopped from pv-b first (restore it to pv-b afterwards).
Impact check DONE 2026-10-22 19:30 (nothing pushed/deployed): prove.sh on host Node 22.23.4 GREEN —
suites 25,620 pass / 0 fail (api 12,162, web 5,050, whole-chain 5,166, ai-gateway 2,583, contracts 487),
real-DB 534/534, journeys 88/88 first try. First run was RED only on the API body-validation audit:
the festival-theme controller's `SetHomeThemeBody` (not *Dto) — already on main/Production, values were
still validated; fixed locally as `SetHomeThemeDto` (commit `8d7cdca01` on the impact branch). Proof API
on Node 22.23.4: plain JSON login → 400 field validation; br/gzip → 415 "content encoding unsupported".
Proof stack returned to pv-b; trial stack untouched. To ship: rebase branch on origin/main, push same tree
to develop+main, start UAT (owner paused it), UAT → Production with owner sign-in.
Owner 2026-10-22 ~19:55: "ฉันเปิด uat แล้วคุณเริ่มลงมือแก้ไขได้เลย" (UAT was in fact still stopped; I started it
with power-uat after the owner typed the UAT MFA code). Landed main `8d7cdca01` / develop `478b84f10` (same tree).
DONE 2026-10-22 20:36: Node 22.23.4 + inflate:false LIVE on UAT and Production (see runbook entry
"Node 22.23.4 + API refuses compressed request bodies"). UAT paused afterwards on the owner's word.
