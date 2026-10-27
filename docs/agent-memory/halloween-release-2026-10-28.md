# Agent Memory: Halloween UAT and Production release

Status: SHARE_REFINEMENT_VERIFIED_AWAITING_NEW_RELEASE. Owner authorized UAT and Production: “โอเค เอาขึ้น uat และ prod ได้”.
Owner: Root; Sol performed a bounded read-only application review.
Scope: Approved Halloween activity, 23 cards and sharing, server random draw without signing keys, theme gate, loading/smoke/audio; previously authorized dependency security updates.
Decisions: Use the existing local Kamal UAT release then promote its signed immutable images to Production. No new infrastructure, game key, database schema or theme-setting change. Preserve customer OPEN and perform current administrator acceptance. Read both mandatory cloud/deployment runbooks before operations. Owner explicitly directs “แบ่ง agent มา merge เข้า main+develop ด้วยนะ ไม่ต้องเปิด pr merge เลย”; Sol owns direct integration without PR or force push after root verifies the final source.
Open questions: Production MFA identity verified after owner completed the Terminal command. No remote CI pass claimed: GitHub's most recent run 39645146882 is startup_failure with zero jobs/checks. Local verification is retained; no manual CI reruns or workflow/protection changes. Historical queued READY 31611733340 is unchanged since 2026-08-12 with zero jobs, not a newly running release; leave untouched. Do not redispatch a failed deployment.
Artifacts: Current app spec/plan and 53-test/build/browser evidence are in the Halloween documents. Release verification in docs/evidence/halloween-release-2026-10-28/. No PR per owner instruction.
Verification: Local source is current origin/main 86e0e47366617954f6f37f079d9fe18363437096. Release controller hashes match the last accepted Production operation 20261024T170243Z-6e84b33b. Shared private .env.kamal state is in the primary checkout; its old application/controller checkout must not be used. Existing UAT scoped identity verified. No active.json file for either environment; workflow release runs not dispatched.
Next: Finish release checks and source integration, UAT prepare/apply, verify game on UAT, promote same images, administrator/browser/logout and public OPEN acceptance, retain signed results and timings.

## Source verification

- Existing portable verify.sh completed all stages. The first web run found raw caught Error.message display in the game/share UI. Sol replaced these with safe fixed retry copy, preserved timeout wording and added a regression for internal canvas diagnostics. No guard allowlist or suppression added.
- Corrected web full suite: 5,078 pass, zero failed. Other full-suite stages: contracts 487; API 12,163 pass / 200 intentional skipped DB cases; harness 33; LINE whole-chain 5,166; M01 109; P1 30; AI gateway 2,583. All other verify stages pass, including both app typechecks, other package typechecks, migration review and maintenance pins. Counts overlap; not a unique test-case count.
- Sol focused error/lifecycle/share/draw tests: 19 pass. Earlier current feature's 53 focused tests and production build/browser remain retained; the release image build will compile the final safe-copy change again.
- Staged only runtime assets, application/dependency changes, specs/plans/memory and reproducible textual evidence, required JPEG test fixture and current screenshots. Large output/archives and redundant historical screenshots remain local; generated Next files are not included.
- UAT read-only preflight 20261027T194227Z-94dc7a47 passed in 11.347 s, two SSM sessions terminated. No deployment or Production mutation.

## Release ledger

- candidate: 8802028dc967d3f95c2af7548bd2e652b4118a78 (integration of tested source 091b2c5cd42f8f5fed89c189443e2a1fb05a9d23)
- controller: 8802028dc967d3f95c2af7548bd2e652b4118a78; controller hash unchanged da915391c7e6b0ed488add2e655631a44f43f866304caebcc9584faa3e8aa080
- UAT_RUN_ID / READY_RUN_ID / PROD_RUN_ID: NOT_DISPATCHED (local Kamal path)
- UAT prepare: 20261027T194831Z-44f76d82, PREPARED_NO_DEPLOYMENT in 370.827 s; apply: 20261027T195456Z-f11bd9a5, signed ACCEPTED_LINE_DEFERRED in 375.151 s; subsequent game acceptance failed and blocks Production
- Production prepare / promotion operation: NOT_STARTED
- Signed artifacts/digests and final customer acceptance: PENDING
- serving mode: preserve existing live/OPEN; no gate mutation inferred from this request
- owner reference: this chat, direct UAT/Production authorization on 2026-10-28; no new legal artifact or waiver claimed

## Branch integration

Sol integrated directly per owner instruction, without PR or force push. Original main/develop trees were identical despite divergent history; the normal merge reported seven conflicts. Root authorized exact tested-tree resolution after confirming remote tips were unchanged. Merge 8802028dc967d3f95c2af7548bd2e652b4118a78 preserves both histories and has exact tested tree d7d2db0a800d86096c032eca5cc3402aa5f2df9c. Atomic normal push and remote readback show both main/develop at that SHA. Main stays frozen through acceptance. Production read-only preflight 20261027T194749Z-c60ce566 passed in 19.716 s.

## UAT game acceptance failure and correction

- Infrastructure release completed with signed acceptance and transport cleanup, but actual UAT browser at 390 showed the new game and failed its draw. Production promotion was not started. Historical successful infrastructure receipt is retained and is not considered game acceptance.
- Root cause: the combined container proxy sent all `/api/*` except `/api/auth/*` to Nest; the new Next draw route therefore never reached its handler. Local direct Next preview did not include this proxy.
- Sol added only exact `/api/public/halloween/draw` forwarding to Next. Other API paths, headers and maintenance denial remain unchanged. Real HTTP proxy suite: 5 pass. Parent real-Next combined-proxy before/after proof reproduces old 404 and corrected 200 with actual cardId; cross-origin remains 403 and client-selected card remains 400. Runnable proof and output are in the release evidence folder.
- Updated the existing maintenance proxy hash and its validator hash in the legacy workflow, with no policy weakening. Parent reviewed both one-line hash changes. Full production image-security fixture suite passed (exit 0) before source integration. No production cloud mutation, rollback, workflow rerun or duplicate deployment dispatched. Source change requires a new UAT build/release; do not promote the earlier receipt.

## Corrected candidate / UAT retry

- Correction 0fc4d88923a20ec0601777f0b7b31b39018d810d passed the full image-security fixture suite and real-Next combined-proxy proof. Sol merged and atomically pushed both main/develop to 21a8f75a0bd419e020d50c6142419689ed0ee941; exact tested tree e21e239aac991a273015a9d76ddaff0891ce23b5. No PR or force push. Main remains frozen.
- Read-only sibling review confirms Cloudflare Workers preserve the draw pathname, query, POST body and original public X-Forwarded-Host; no edge change required.
- Re-read mandatory deployment protocol; previous UAT operation is terminal and both owned SSM sessions were terminated; no current local operation. New UAT prepare 20261027T201201Z-b6eb7735 started against the corrected candidate. The prior signed infrastructure receipt is not a promotion input.

- Corrected UAT prepare completed PREPARED_NO_DEPLOYMENT in 205.417 s, exact source21a8f75a0bd419e020d50c6142419689ed0ee941, all five phases passed and owned SSM cleanup passed. Proceeding once with that exact prepared build.

- Corrected UAT apply operation: 20261027T201606Z-8c17a366; single apply using prepare20261027T201201Z-b6eb7735.

- Corrected UAT apply20261027T201606Z-8c17a366 ACCEPTED_LINE_DEFERRED in220.38s, KMS verified, all phases and public OPEN passed, both owned SSM sessions terminated. Actual browser390 draw13-frankenstein and1280 redraw21-chonggak-gwishin passed; smoke/back-only spin observed. Download is byte-identical to approved PNG and contains five-field mangmeeplus origin metadata. Screenshots and sanitized receipt summary retained. This exact corrected receipt is the Production promotion input.

- Production promotion prepare: 20261027T202044Z-e6eb95e6 (same signed UAT artifacts, no rebuild).

- Production prepare20261027T202044Z-e6eb95e6 PREPARED_NO_DEPLOYMENT in49.676s, all phases and owned SSM cleanup passed; exact corrected signed UAT artifacts verified. Starting one promotion apply; main remains frozen.

## Owner pause — 2026-10-28

- Owner said “แปบนึง อย่าพึ่งขึ้น prod” after promotion apply began. Root immediately stopped only that controller with SIGINT. Operation20261027T202146Z-24ec654a ended FAILED/Interrupted in46.777s during host-storage-capacity, before publish/provider/database/rollout. productionMutated=false, all four owned SSM sessions terminated, process no longer running, local active guard removed. No Production version change. No retry or rollback dispatched.
- UAT corrected release remains accepted; main/develop remain21a8f75a0bd419e020d50c6142419689ed0ee941. Integration agent instructed to stop pushes/deploys. Retain interrupted receipt and integration checkout. Only resume Production on owner's explicit instruction after reconciling this receipt; do not automatically retry.
- Owner's next question asks how the current share buttons and copied caption/link work; answer from source without changing implementation.

## Sharing change and release resumed

Owner “แก้เลย เอาชึ้นไวๆ” explicitly resumes release after approving image+caption sharing for all social icons and best-effort automatic caption copying. Update spec/plan before implementation. New source invalidates older prepared/promotion inputs; prepare/apply UAT once after verification/integration, then promote its exact signed artifacts. Preserve interrupted Production receipt and reconcile it before any new apply.

- Reconciled interrupted Production run from original terminal phases, no publication/provider/database/rollout and productionMutated=false; controller cleanup removed its owned remote/local lock and terminated all4SSM sessions. Fresh read-only preflight20261027T203012Z-dbce2de6 passed18.364s with cleanup; no rollback/repair needed. New source requires new UAT after owner resumes.

- Sharing refinement: Sol changed only component+spec; root reviewed actual handlers. All four triggers pass preparedJPEG/caption/homepage and start clipboard without awaiting; copy failures remain independent, manual fallback does not steal focus, card/unmount cancels late feedback. PurePNG save unchanged. Focused21tests and standalone webTypeScript pass; root fullweb suite5082/0 and diff-check pass.
- Real browser390/1280: no sideways overflow, primary action group48px high/equal widths, social icons48×48. Clipboard readback equals exact zombie caption+homepage+LINE. Native Chrome on macOS: Facebook, Instagram and TikTok each open the OS share sheet; confirmed copied-caption feedback; Escape restores retryable card. No app post sent and no claim of physical iPhone/Android social acceptance.
